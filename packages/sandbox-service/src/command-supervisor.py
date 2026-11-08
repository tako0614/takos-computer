"""Own one command family; never signal a PID outside this process's children.

The single-threaded subreaper does not reap a child before signalling it. Thus
waitid(WNOWAIT) proves ownership and an exited child's PID cannot be recycled.
The primary PID remains reserved until the entire family has been collected.
"""

import ctypes
import base64
import json
import os
import selectors
import signal
import sys
import time

SIGNALS = {name: getattr(signal, name) for name in (
    "SIGHUP", "SIGINT", "SIGTERM", "SIGKILL", "SIGUSR1", "SIGUSR2"
)}
MAX_FRAME = 64 * 1024 * 1024
STATUS_FD = 1
MAX_OUTPUT_BYTES = 256 * 1024


def emit(packet):
    data = (json.dumps(packet, separators=(",", ":")) + "\n").encode()
    while data:
        data = data[os.write(STATUS_FD, data):]


def child_info(pid):
    # SIGCHLD is never ignored; no thread or Popen object can reap concurrently.
    return os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)


def children():
    with open(f"/proc/self/task/{os.getpid()}/children", encoding="ascii") as source:
        return [int(value) for value in source.read().split()]


def signal_child(pid, number):
    info = child_info(pid)  # ECHILD fails closed, without sending a signal.
    if info is None:
        os.kill(pid, number)


def run():
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise RuntimeError("Child subreaper is unavailable")
    if libc.prctl(4, 0, 0, 0, 0) != 0:  # PR_SET_DUMPABLE: private control FDs
        raise RuntimeError("Supervisor privacy is unavailable")
    children()  # Require the ownership source before creating any command.
    buffer = bytearray()
    while b"\n" not in buffer:
        part = os.read(0, 8192)
        if not part:
            return 1
        buffer.extend(part)
        if len(buffer) > MAX_FRAME:
            raise RuntimeError("Supervisor configuration is too large")
    raw, _, rest = buffer.partition(b"\n")
    config = json.loads(raw)
    if set(config) != {"version", "argv", "cwd", "env", "grace_ms"}:
        raise RuntimeError("Invalid supervisor configuration")
    if (config["version"] != 1 or config["grace_ms"] != 1000
            or not isinstance(config["argv"], list) or not config["argv"]
            or not all(isinstance(arg, str) for arg in config["argv"])
            or not isinstance(config["cwd"], str)
            or not isinstance(config["env"], dict)
            or not all(isinstance(k, str) and isinstance(v, str)
                       for k, v in config["env"].items())):
        raise RuntimeError("Invalid supervisor configuration")

    gate_read, gate_write = os.pipe()
    output_pipes = {name: os.pipe() for name in ("stdout", "stderr")}
    primary = os.fork()
    if primary == 0:
        try:
            os.close(gate_write)
            for number in SIGNALS.values():
                if number != signal.SIGKILL:
                    signal.signal(number, signal.SIG_DFL)
            # Python ignores these in its own interpreter; command processes
            # must receive ordinary exec signal dispositions.
            for name in ("SIGPIPE", "SIGXFZ", "SIGXFSZ"):
                if hasattr(signal, name):
                    signal.signal(getattr(signal, name), signal.SIG_DFL)
            if os.read(gate_read, 1) != b"1":
                os._exit(1)
            os.dup2(output_pipes["stdout"][1], 1)
            os.dup2(output_pipes["stderr"][1], 2)
            for value in os.listdir("/proc/self/fd"):
                fd = int(value)
                if fd > 2:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
            stdin = os.open(os.devnull, os.O_RDONLY)
            os.dup2(stdin, 0)
            if stdin > 2:
                os.close(stdin)
            os.chdir(config["cwd"])
            os.execvpe(config["argv"][0], config["argv"], config["env"])
        except BaseException:
            os.write(2, b"Command startup failed\n")
            os._exit(1)
    os.close(gate_read)
    for read_fd, write_fd in output_pipes.values():
        os.close(write_fd)
        os.set_blocking(read_fd, False)
    # Keep the child blocked until Bun registers its public PID and sends start.
    try:
        emit({"type": "started", "pid": primary})
    except (BrokenPipeError, OSError):
        os.close(gate_write)
        os.kill(primary, signal.SIGKILL)  # Direct, unreaped child.
        os.waitpid(primary, 0)
        return 1

    pending_signal = None

    def interrupted(number, _frame):
        nonlocal pending_signal
        pending_signal = number

    for number in SIGNALS.values():
        if number != signal.SIGKILL:
            signal.signal(number, interrupted)
    selector = selectors.DefaultSelector()
    selector.register(0, selectors.EVENT_READ, "control")
    totals = {"stdout": 0, "stderr": 0}
    for name, (read_fd, _) in output_pipes.items():
        selector.register(read_fd, selectors.EVENT_READ, name)
    open_outputs = set(totals)
    protocol_open = True
    buffer = bytearray(rest)
    stopping = None
    forced = False
    initial_signal = signal.SIGTERM
    delivered = {}
    error_sent = False
    primary_exit = None

    def stop(number):
        nonlocal stopping, forced, initial_signal
        if stopping is None:
            stopping = time.monotonic()
        if number == signal.SIGKILL:
            forced = True
        initial_signal = number
        # The primary is an unreaped child, reserving both PID and group ID.
        child_info(primary)
        try:
            os.killpg(primary, number)
        except ProcessLookupError:
            pass
        for pid in children():
            if child_info(pid) is None:
                if os.getpgid(pid) != primary:
                    signal_child(pid, number)
                delivered[pid] = number

    def send(packet):
        nonlocal protocol_open
        if protocol_open:
            try:
                emit(packet)
            except OSError:
                protocol_open = False
                # A lost reader is not permission to release ownership. Keep
                # draining/reaping the family even though no ACK can be sent.
                stop(signal.SIGKILL)

    try:
        while True:
            if pending_signal is not None:
                stop(pending_signal)
                pending_signal = None
            while b"\n" in buffer:
                raw, _, buffer = buffer.partition(b"\n")
                try:
                    message = json.loads(raw)
                    if message == {"start": True}:
                        if gate_write is not None:
                            if stopping is None:
                                os.write(gate_write, b"1")
                            os.close(gate_write)
                            gate_write = None
                    elif set(message) == {"signal"} and message["signal"] in SIGNALS:
                        stop(SIGNALS[message["signal"]])
                    else:
                        raise ValueError()
                except (ValueError, TypeError):
                    if not error_sent:
                        send({"type": "error", "message": "Invalid supervisor control message"})
                        error_sent = True
                    stop(signal.SIGKILL)

            info = child_info(primary)
            if info is not None and primary_exit is None:
                primary_exit = info.si_status if info.si_code == os.CLD_EXITED else 128 + info.si_status
                stop(signal.SIGTERM)
            if stopping is not None:
                elapsed = time.monotonic() - stopping
                if elapsed >= config["grace_ms"] / 1000:
                    forced = True
                for pid in children():
                    info = child_info(pid)
                    if info is None:
                        number = signal.SIGKILL if forced else initial_signal
                        if delivered.get(pid) != number:
                            signal_child(pid, number)
                            delivered[pid] = number
                    elif pid != primary:
                        os.waitpid(pid, 0)
                        delivered.pop(pid, None)
                # Re-read after reaping: newly orphaned descendants have become
                # children of this subreaper before their parent became waitable.
                if primary_exit is not None and children() == [primary] and not open_outputs:
                    os.waitpid(primary, 0)
                    send({"type": "done", "exit_code": primary_exit,
                          "stdout_bytes": totals["stdout"], "stderr_bytes": totals["stderr"]})
                    return primary_exit
                if elapsed >= config["grace_ms"] / 1000 + 0.25 and not error_sent:
                    send({"type": "error", "message": "Command descendant cleanup did not complete"})
                    error_sent = True
                    # Retain ownership and continue draining after reporting the
                    # failure. Never acknowledge cleanup while children remain.
            events = selector.select(0.01)
            # Handle control first and at most one bounded read per output per
            # turn, so a command flooding either pipe cannot starve signals.
            for key, _ in sorted(events, key=lambda event: event[0].data != "control"):
                name = key.data
                part = os.read(key.fd, 8192)
                if name == "control":
                    if not part:
                        selector.unregister(0)
                        stop(signal.SIGKILL)
                    else:
                        buffer.extend(part)
                        if len(buffer) > MAX_FRAME:
                            send({"type": "error", "message": "Supervisor control message is too large"})
                            buffer.clear()
                            stop(signal.SIGKILL)
                elif not part:
                    selector.unregister(key.fd)
                    os.close(key.fd)
                    open_outputs.remove(name)
                else:
                    remaining = max(0, MAX_OUTPUT_BYTES - totals[name])
                    totals[name] += len(part)
                    if remaining:
                        send({"type": "output", "stream": name,
                              "data": base64.b64encode(part[:remaining]).decode("ascii")})
    finally:
        selector.close()
        if gate_write is not None:
            os.close(gate_write)


if __name__ == "__main__":
    try:
        sys.exit(run())
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        try:
            emit({"type": "error", "message": "Command supervision failed"})
        except OSError:
            pass
        sys.exit(1)
