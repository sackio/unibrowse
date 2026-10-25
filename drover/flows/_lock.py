#!/usr/bin/env python3
"""Two locks for a kept Drover profile, because there are two different races.

⭐ WHY TWO. A Chrome profile directory is corrupted if two Chromes open it at
once -- that is a HARD, millisecond-scale race, and the fix is an OS flock held
only while a container runs. A *seat* holding a profile across several runs (a
shopping seat working an Amazon session over ten minutes) is a SOFT, advisory
claim: other seats should see it is taken and keep off, but nothing melts if the
advice is ignored. One lock cannot be both -- a flock cannot outlive the process
that holds it, and an advisory claim gives no protection against a literal
double-open. So:

  chrome_lock(profile)   flock on {profile}.run/.chrome.lock, non-blocking, held
                         for exactly one container's lifetime. The corruption
                         guard. Every path that launches a container takes it.

  reserve/release        a holder dir under _locks/<name>, created atomically
                         with mkdir. The seat-level claim. `drover run` takes a
                         short one for its own run; keepwarm SKIPS a profile a
                         different seat has reserved rather than fighting it.

⛔ A reservation is advisory and the chrome_lock is not: the chrome_lock is the
one that actually prevents the corruption. The reservation exists so a long
logical session reads as busy and the warm cron steps aside, not as a substitute
for the flock.
"""
import errno, fcntl, json, os, pathlib, socket, time
from contextlib import contextmanager

PROFILES_DIR = os.environ.get("DROVER_PROFILES_DIR", "/mnt/nas/data/.secrets/drover-profiles")
LOCKS_DIR = os.path.join(PROFILES_DIR, "_locks")
DEFAULT_TTL_MIN = 30


def profile_path(name_or_path):
    """A bare name resolves under PROFILES_DIR; a path is taken as given."""
    if "/" in str(name_or_path):
        return str(pathlib.Path(name_or_path).resolve())
    return os.path.join(PROFILES_DIR, name_or_path)


def profile_name(name_or_path):
    return pathlib.Path(profile_path(name_or_path)).name


def _rundir(profile):
    d = pathlib.Path(profile_path(profile) + ".run")
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    return d


def _lockfile(profile):
    return str(_rundir(profile) / ".chrome.lock")


@contextmanager
def chrome_lock(profile, blocking=False, timeout=0):
    """Hold the per-profile Chrome lock for the body. Non-blocking by default:
    if another container is already driving this profile it raises at once with
    a message that names the profile, rather than silently queueing. Pass
    blocking=True (optionally with a timeout) to wait instead."""
    path = _lockfile(profile)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    deadline = time.time() + timeout
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as e:
                if e.errno not in (errno.EAGAIN, errno.EACCES):
                    raise
                if not blocking:
                    raise SystemExit(
                        "⛔ profile %r is already being driven by another Chrome "
                        "(lock %s). One profile, one browser at a time -- wait for it "
                        "to finish or pick another profile." % (profile_name(profile), path))
                if timeout and time.time() > deadline:
                    raise SystemExit("⛔ timed out waiting for the Chrome lock on %r "
                                     "after %ss." % (profile_name(profile), timeout))
                time.sleep(0.5)
        try:
            os.write(fd, ("%d %s\n" % (os.getpid(), socket.gethostname())).encode())
        except OSError:
            pass
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def chrome_lock_free(profile):
    """True if no container currently holds the Chrome lock (best-effort probe)."""
    path = _lockfile(profile)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fd, fcntl.LOCK_UN)
        return True
    except OSError:
        return False
    finally:
        os.close(fd)


# ---- reservation (advisory seat claim) ----------------------------------

def _holder_dir(name):
    return os.path.join(LOCKS_DIR, profile_name(name))


def reservation(name):
    """The current reservation record, or None. {seat, host, at, ttl_min}."""
    try:
        with open(os.path.join(_holder_dir(name), "holder")) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _is_stale(name, rec):
    """A reservation is stale when its TTL has elapsed AND no container is
    currently holding the Chrome lock -- i.e. the seat walked away. The flock
    test is what distinguishes 'idle too long' from 'still actively driving'."""
    if not rec:
        return True
    age_ok = time.time() > float(rec.get("at", 0)) + float(rec.get("ttl_min", DEFAULT_TTL_MIN)) * 60
    return age_ok and chrome_lock_free(name)


def reserved_by_other(name, seat):
    """True if a DIFFERENT, non-stale seat holds the reservation."""
    rec = reservation(name)
    return bool(rec) and rec.get("seat") != seat and not _is_stale(name, rec)


def reserve(name, seat, ttl_min=DEFAULT_TTL_MIN, steal=False):
    """Claim the profile for `seat`. Refreshes if `seat` already holds it,
    reclaims a stale claim, and refuses an active claim by another seat unless
    `steal`. Returns (ok, message)."""
    os.makedirs(LOCKS_DIR, exist_ok=True)
    try:
        os.chmod(LOCKS_DIR, 0o700)
    except OSError:
        pass
    d = _holder_dir(name)
    rec = {"seat": seat, "host": socket.gethostname(), "at": time.time(), "ttl_min": ttl_min}
    try:
        os.mkdir(d)  # atomic: a race is won by whoever's mkdir succeeds
    except FileExistsError:
        cur = reservation(name)
        if cur and cur.get("seat") == seat:
            pass  # refresh below
        elif steal or _is_stale(name, cur):
            pass  # take it over
        else:
            return False, ("reserved by %s since %s (ttl %sm) -- still active. "
                           "Use --steal only if you know it is abandoned."
                           % (cur.get("seat"), _ts(cur.get("at")), cur.get("ttl_min")))
    with open(os.path.join(d, "holder"), "w") as fh:
        json.dump(rec, fh)
    return True, "reserved %s for %s (ttl %sm)" % (profile_name(name), seat, ttl_min)


def release(name, seat=None, steal=False):
    """Drop the reservation. Only the holder may release unless `steal`."""
    rec = reservation(name)
    if not rec:
        return True, "%s was not reserved" % profile_name(name)
    if seat and rec.get("seat") != seat and not steal:
        return False, ("%s is held by %s, not %s -- pass --steal to force."
                       % (profile_name(name), rec.get("seat"), seat))
    import shutil
    shutil.rmtree(_holder_dir(name), ignore_errors=True)
    return True, "released %s" % profile_name(name)


def _ts(epoch):
    try:
        return time.strftime("%H:%M", time.localtime(float(epoch)))
    except (TypeError, ValueError):
        return "?"
