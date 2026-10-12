/* ── A POINTER AND KEYBOARD THAT ARE NOT THE OPERATOR'S ─────────────────────
 *
 * Ben, Slack #unibrowse 2026-10-10 20:31: "is it possible to make it so that
 * these browsers don't hog my mouse or keyboard but have like their own Master
 * keyboard that they can use I want to be able to jump in and control them if
 * I want to but I don't want them to be able to control me moving the mouse
 * elsewhere" — then 20:37: "yes let's get that built".
 *
 * ⭐ X11 already models this: XInput2 supports several MASTER device pairs on
 * one display. Each master has its own cursor and its own XTEST slave devices,
 * so a synthetic event delivered through one master moves THAT cursor and
 * leaves the operator's alone. This tool creates such a pair and drives it.
 *
 * ⛔ A SECOND MASTER PAIR MAKES CHROME DEAF TO THE KEYBOARD WHILE IT EXISTS.
 * MEASURED on office 2026-10-11/12 by `unibrowse` and `scripts`, both
 * directions, repeatedly: with a second master pair present Chrome stops
 * acting on key events (XTEST keys included) while GTK applications on the
 * same display keep accepting them; remove the pair and Chrome accepts keys
 * again. Mechanism proven.
 * ⚠️ NOT established as the cause of the 2026-10-11 office keyboard incident.
 * `scripts`, 11:05: "Strong enough for you to act on: stop creating a
 * persistent master. Not strong enough for anyone to write 'this was the cause
 * of the 10-11 outage'." Record and read it that way — see memo 00116277.
 *
 * ⇒ THEREFORE: no command here leaves a master pair behind. move/click/type
 * create an EPHEMERAL pair named "agent-input:<name>:<pid>", do the one
 * operation, and remove it before exiting, so Chrome's deaf window is the
 * length of one click rather than the length of a session. The old behaviour —
 * `create` once and leave it up — is still reachable, but only behind an
 * explicit --persistent flag that names what it costs.
 *
 * ⛔ WHY NOT xdotool: XTestFakeKeyEvent/XTestFakeButtonEvent have no device
 * argument — they always go to the core XTEST devices, i.e. the operator's
 * pointer. The device-aware calls (XTestFakeDeviceKeyEvent,
 * XTestFakeDeviceButtonEvent, XIWarpPointer) are the whole reason this is C
 * and not a shell one-liner.
 *
 * ⚠️ WHAT THIS DOES NOT GIVE YOU: a second cursor does not stop FOCUS moving.
 * Clicking a window can still make it the keyboard-focused window under some
 * window managers, so the operator can still lose focus mid-sentence even
 * though their cursor never moved. Measure before relying on it.
 *
 * ⚠️ AND IT IS NOT NEEDED FOR BROWSER WORK. unibrowse drives pages with CDP
 * events addressed to a tab's renderer, which touch no X device at all. This
 * exists for the case where a site rejects synthetic CDP input and only a real
 * event will do.
 *
 * Build (headers and libs are already on office; nothing to install):
 *   gcc -O2 -o agent-input agent-input.c -lX11 -lXi -lXtst
 */

#include <X11/Xlib.h>
#include <X11/extensions/XInput.h>
#include <X11/extensions/XInput2.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <X11/XKBlib.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define EPHEMERAL_PREFIX "agent-input:"

static Display *dpy;

/* Set only while THIS process owns an ephemeral master pair that must come
 * back down before we exit. Empty means we created nothing and must remove
 * nothing — removing a pair we did not create would pull the rug from under
 * whoever did. */
static char owned_master[256];

static void die(const char *m) { fprintf(stderr, "agent-input: %s\n", m); exit(1); }

static void remove_master(const char *name, int verbose);

/* atexit + signal cleanup. ⚠️ Xlib is not async-signal-safe; this is a
 * short-lived CLI and a leaked master pair is the worse failure, so the
 * handler does the removal and then _exit()s rather than returning. A SIGKILL
 * still leaks one — that is what `sweep` is for. */
static void cleanup_owned(void)
{
    if (!owned_master[0] || !dpy) return;
    char n[256];
    snprintf(n, sizeof n, "%s", owned_master);
    owned_master[0] = '\0';          /* re-entrancy guard */
    remove_master(n, 0);
}

static void on_signal(int sig)
{
    cleanup_owned();
    _exit(128 + sig);
}

/* Resolve a master by name ("agents pointer" / "agents keyboard") or a slave
 * XTEST device belonging to it. Returns the XInput2 device id, or -1. */
static int find_device(const char *name, int want_master)
{
    int n, i, found = -1;
    XIDeviceInfo *info = XIQueryDevice(dpy, XIAllDevices, &n);
    if (!info) die("XIQueryDevice failed");
    for (i = 0; i < n; i++) {
        int is_master = (info[i].use == XIMasterPointer || info[i].use == XIMasterKeyboard);
        if (want_master != is_master) continue;
        if (strcmp(info[i].name, name) == 0) { found = info[i].deviceid; break; }
    }
    XIFreeDeviceInfo(info);
    return found;
}

static void cmd_list(void)
{
    int n, i;
    XIDeviceInfo *info = XIQueryDevice(dpy, XIAllDevices, &n);
    if (!info) die("XIQueryDevice failed");
    for (i = 0; i < n; i++) {
        const char *kind = "slave";
        if (info[i].use == XIMasterPointer)  kind = "MASTER pointer";
        if (info[i].use == XIMasterKeyboard) kind = "MASTER keyboard";
        printf("%3d  %-18s %s\n", info[i].deviceid, kind, info[i].name);
    }
    XIFreeDeviceInfo(info);
}

/* How many master pointers exist. The baseline on a normal display is 1, the
 * core pair. Anything above that is a Chrome-deafening pair, ours or not. */
static int count_master_pointers(void)
{
    int n, i, c = 0;
    XIDeviceInfo *info = XIQueryDevice(dpy, XIAllDevices, &n);
    if (!info) die("XIQueryDevice failed");
    for (i = 0; i < n; i++) if (info[i].use == XIMasterPointer) c++;
    XIFreeDeviceInfo(info);
    return c;
}

static void add_master(const char *name, int verbose)
{
    XIAddMasterInfo add;
    add.type = XIAddMaster;
    add.name = (char *)name;
    add.send_core = True;   /* so ordinary clients see its events at all */
    add.enable = True;
    if (XIChangeHierarchy(dpy, (XIAnyHierarchyChangeInfo *)&add, 1) != Success)
        die("XIChangeHierarchy(add) failed");
    XSync(dpy, False);
    if (verbose)
        printf("created master pair \"%s pointer\" / \"%s keyboard\"\n", name, name);
}

static void remove_master(const char *name, int verbose)
{
    char buf[256];
    XIRemoveMasterInfo rem;
    int id;
    snprintf(buf, sizeof buf, "%s pointer", name);
    id = find_device(buf, 1);
    if (id < 0) {
        if (verbose) die("no such master pointer");
        return;
    }
    rem.type = XIRemoveMaster;
    rem.deviceid = id;
    /* ⛔ Hand the slaves back to the core pair rather than floating them: a
     * floated physical device stops working for the human at the desk. */
    rem.return_mode = XIAttachToMaster;
    rem.return_pointer = 2;   /* Virtual core pointer  */
    rem.return_keyboard = 3;  /* Virtual core keyboard */
    if (XIChangeHierarchy(dpy, (XIAnyHierarchyChangeInfo *)&rem, 1) != Success) {
        if (verbose) die("XIChangeHierarchy(remove) failed");
        fprintf(stderr, "agent-input: WARNING could not remove master \"%s\" — "
                        "Chrome stays deaf until it goes; run: agent-input remove '%s'\n",
                name, name);
        return;
    }
    XSync(dpy, False);
    if (verbose) printf("removed master pair \"%s\"\n", name);
}

/* Make a master usable for ONE operation, and arrange for it to go away.
 * Writes the name to use into `out`.
 * - An existing master of that exact name is reused and NOT removed on exit
 *   (someone else owns it — most likely a deliberate --persistent pair).
 * - Otherwise an ephemeral pair "agent-input:<name>:<pid>" is created and
 *   registered for removal at exit. */
static void ensure_master(const char *name, char *out, size_t outsz)
{
    char probe[256];
    snprintf(probe, sizeof probe, "%s pointer", name);
    if (find_device(probe, 1) >= 0) {
        snprintf(out, outsz, "%s", name);
        return;
    }
    snprintf(out, outsz, EPHEMERAL_PREFIX "%s:%ld", name, (long)getpid());
    add_master(out, 0);
    snprintf(owned_master, sizeof owned_master, "%s", out);
}

/* The XTEST slave Xi2 creates for each master is named "<master> XTEST pointer"
 * / "<master> XTEST keyboard". XTestFakeDevice* wants an XDevice from the old
 * XInput API, so we open it by that id. */
static XDevice *open_xtest(const char *master, const char *which)
{
    char buf[256];
    int id;
    XDevice *d;
    snprintf(buf, sizeof buf, "%s XTEST %s", master, which);
    id = find_device(buf, 0);
    if (id < 0) { fprintf(stderr, "agent-input: no device named \"%s\"\n", buf); exit(1); }
    d = XOpenDevice(dpy, id);
    if (!d) die("XOpenDevice failed");
    return d;
}

static void warp(const char *master, int x, int y)
{
    char buf[256];
    int id;
    snprintf(buf, sizeof buf, "%s pointer", master);
    id = find_device(buf, 1);
    if (id < 0) die("no such master pointer");
    XIWarpPointer(dpy, id, None, DefaultRootWindow(dpy), 0, 0, 0, 0, x, y);
    XSync(dpy, False);
}

/* ⚠️ `move` on its own is only meaningful against a --persistent pair: an
 * ephemeral cursor is removed as this process exits, so the cursor you moved
 * disappears with it. `click` is unaffected — it warps and clicks inside the
 * one invocation. */
static void cmd_move(const char *name, int x, int y)
{
    char m[256];
    ensure_master(name, m, sizeof m);
    warp(m, x, y);
}

static void cmd_click(const char *name, int x, int y, int button)
{
    char m[256];
    XDevice *p;
    ensure_master(name, m, sizeof m);
    p = open_xtest(m, "pointer");
    warp(m, x, y);
    XTestFakeDeviceButtonEvent(dpy, p, button, True,  NULL, 0, CurrentTime);
    XTestFakeDeviceButtonEvent(dpy, p, button, False, NULL, 0, CurrentTime);
    XSync(dpy, False);
    XCloseDevice(dpy, p);
}

static void cmd_type(const char *name, const char *text)
{
    char m[256];
    XDevice *k;
    const unsigned char *s;
    ensure_master(name, m, sizeof m);
    k = open_xtest(m, "keyboard");
    for (s = (const unsigned char *)text; *s; s++) {
        char kname[8];
        KeySym ks;
        KeyCode kc, shift;
        int need_shift = 0;
        if (*s == ' ') ks = XK_space;
        else if (*s == '\n') ks = XK_Return;
        else {
            snprintf(kname, sizeof kname, "%c", *s);
            ks = XStringToKeysym(kname);
            if (ks == NoSymbol) continue;
        }
        kc = XKeysymToKeycode(dpy, ks);
        if (!kc) continue;
        /* uppercase and shifted punctuation need the modifier held */
        if (XkbKeycodeToKeysym(dpy, kc, 0, 0) != ks &&
            XkbKeycodeToKeysym(dpy, kc, 0, 1) == ks) need_shift = 1;
        shift = XKeysymToKeycode(dpy, XK_Shift_L);
        if (need_shift) XTestFakeDeviceKeyEvent(dpy, k, shift, True, NULL, 0, CurrentTime);
        XTestFakeDeviceKeyEvent(dpy, k, kc, True,  NULL, 0, CurrentTime);
        XTestFakeDeviceKeyEvent(dpy, k, kc, False, NULL, 0, CurrentTime);
        if (need_shift) XTestFakeDeviceKeyEvent(dpy, k, shift, False, NULL, 0, CurrentTime);
    }
    XSync(dpy, False);
    XCloseDevice(dpy, k);
}

/* `create` is now the exception, not the normal path. It needs --persistent
 * because a pair left standing is the thing that makes Chrome deaf. */
static void cmd_create(const char *name, int persistent)
{
    if (!persistent) {
        fprintf(stderr,
            "agent-input: refusing to leave a master pair standing.\n"
            "  A second master pair makes Chrome ignore the keyboard for as long as it\n"
            "  exists (measured on office 2026-10-11/12, both directions; GTK apps are\n"
            "  unaffected). move/click/type now create and remove their own pair, so you\n"
            "  do not need this.\n"
            "  If you genuinely want a standing pair:  agent-input create %s --persistent\n"
            "  and take it down with:                  agent-input remove %s\n", name, name);
        exit(3);
    }
    add_master(name, 1);
    printf("⛔ Chrome will ignore the keyboard while this pair exists. "
           "Remove it with: agent-input remove %s\n", name);
}

/* Remove ephemeral pairs left by processes that are gone (a SIGKILL, a crash).
 * Only names matching "agent-input:<something>:<pid>" are touched, and only
 * when that pid is no longer alive — a live sibling invocation is left alone. */
static void cmd_sweep(void)
{
    int n, i, removed = 0, skipped = 0;
    XIDeviceInfo *info = XIQueryDevice(dpy, XIAllDevices, &n);
    char names[32][256];
    int count = 0;
    if (!info) die("XIQueryDevice failed");
    for (i = 0; i < n && count < 32; i++) {
        char *p;
        long pid;
        if (info[i].use != XIMasterPointer) continue;
        if (strncmp(info[i].name, EPHEMERAL_PREFIX, strlen(EPHEMERAL_PREFIX)) != 0) continue;
        /* strip the trailing " pointer" that master names carry */
        snprintf(names[count], sizeof names[count], "%s", info[i].name);
        p = strstr(names[count], " pointer");
        if (p) *p = '\0';
        p = strrchr(names[count], ':');
        if (!p || !p[1]) continue;
        pid = strtol(p + 1, NULL, 10);
        if (pid > 0 && kill((pid_t)pid, 0) == 0) { skipped++; continue; }  /* still running */
        count++;
    }
    XIFreeDeviceInfo(info);
    for (i = 0; i < count; i++) { remove_master(names[i], 0); removed++; }
    printf("sweep: removed %d stale ephemeral pair(s), left %d live one(s) alone, "
           "%d master pointer(s) remain (1 = clean)\n",
           removed, skipped, count_master_pointers());
}

/* Prove the create/remove path without touching the operator's screen: no
 * warp, no click, no key. Creates the ephemeral pair, reports the master count
 * while it is up, lets the exit handler remove it, and reports the count
 * again. A final count of 1 is the whole assertion. */
static void cmd_selftest(void)
{
    char m[256];
    int before = count_master_pointers(), during, after;
    ensure_master("selftest", m, sizeof m);
    during = count_master_pointers();
    cleanup_owned();
    after = count_master_pointers();
    printf("selftest: master pointers before=%d during=%d after=%d  name=\"%s\"\n",
           before, during, after, m);
    if (after != before) {
        fprintf(stderr, "agent-input: SELFTEST FAILED — the pair was not removed\n");
        exit(1);
    }
    printf("selftest: OK — nothing left behind\n");
}

/* Where is the OPERATOR's cursor? The point of this tool is that our events
 * never move it, and this is how you check rather than assume. */
static void cmd_corepos(void)
{
    Window r, c;
    int rx, ry, wx, wy;
    unsigned int mask;
    XQueryPointer(dpy, DefaultRootWindow(dpy), &r, &c, &rx, &ry, &wx, &wy, &mask);
    printf("core pointer at %d,%d\n", rx, ry);
}

static int has_flag(int argc, char **argv, const char *flag)
{
    int i;
    for (i = 1; i < argc; i++) if (!strcmp(argv[i], flag)) return 1;
    return 0;
}

int main(int argc, char **argv)
{
    int major = 2, minor = 2, ev, err;
    int persistent = has_flag(argc, argv, "--persistent");
    if (persistent) {   /* drop the flag so positional parsing stays simple */
        int i, j;
        for (i = 1, j = 1; i < argc; i++)
            if (strcmp(argv[i], "--persistent")) argv[j++] = argv[i];
        argc = j;
    }
    if (argc < 2) {
        fprintf(stderr,
            "usage: agent-input <command>\n"
            "  list                         every input device, masters marked\n"
            "  move <name> <x> <y>          move a private cursor there (needs --persistent\n"
            "                               to outlive the call — see the note on cmd_move)\n"
            "  click <name> <x> <y> [btn]   warp and click with it (default button 1)\n"
            "  type <name> <text>           type with its keyboard\n"
            "  corepos                      where the operator's cursor is\n"
            "  selftest                     prove the pair is created and removed\n"
            "  sweep                        remove ephemeral pairs whose process died\n"
            "  create <name> --persistent   leave a pair standing (⛔ deafens Chrome)\n"
            "  remove <name>                take such a pair back down\n"
            "\n"
            "move/click/type create their own master pair and REMOVE it before exiting:\n"
            "a standing second master pair makes Chrome ignore the keyboard while it\n"
            "exists (measured, office 2026-10-11/12). See memo 00116277.\n");
        return 2;
    }
    dpy = XOpenDisplay(NULL);
    if (!dpy) die("cannot open display (set DISPLAY)");
    if (!XQueryExtension(dpy, "XInputExtension", &major, &ev, &err))
        die("XInput extension missing");
    major = 2; minor = 2;
    if (XIQueryVersion(dpy, &major, &minor) != Success)
        die("XInput2 unavailable");

    atexit(cleanup_owned);
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGHUP, on_signal);

    if (!strcmp(argv[1], "list") && argc == 2) cmd_list();
    else if (!strcmp(argv[1], "create") && argc == 3) cmd_create(argv[2], persistent);
    else if (!strcmp(argv[1], "remove") && argc == 3) remove_master(argv[2], 1);
    else if (!strcmp(argv[1], "move") && argc == 5) cmd_move(argv[2], atoi(argv[3]), atoi(argv[4]));
    else if (!strcmp(argv[1], "click") && (argc == 5 || argc == 6))
        cmd_click(argv[2], atoi(argv[3]), atoi(argv[4]), argc == 6 ? atoi(argv[5]) : 1);
    else if (!strcmp(argv[1], "type") && argc == 4) cmd_type(argv[2], argv[3]);
    else if (!strcmp(argv[1], "corepos") && argc == 2) cmd_corepos();
    else if (!strcmp(argv[1], "selftest") && argc == 2) cmd_selftest();
    else if (!strcmp(argv[1], "sweep") && argc == 2) cmd_sweep();
    else die("bad arguments — run with no arguments for usage");

    cleanup_owned();
    XCloseDisplay(dpy);
    return 0;
}
