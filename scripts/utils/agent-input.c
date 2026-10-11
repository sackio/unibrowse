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
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static Display *dpy;

static void die(const char *m) { fprintf(stderr, "agent-input: %s\n", m); exit(1); }

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

static void cmd_create(const char *name)
{
    XIAddMasterInfo add;
    add.type = XIAddMaster;
    add.name = (char *)name;
    add.send_core = True;   /* so ordinary clients see its events at all */
    add.enable = True;
    if (XIChangeHierarchy(dpy, (XIAnyHierarchyChangeInfo *)&add, 1) != Success)
        die("XIChangeHierarchy(add) failed");
    XSync(dpy, False);
    printf("created master pair \"%s pointer\" / \"%s keyboard\"\n", name, name);
}

static void cmd_remove(const char *name)
{
    char buf[256];
    XIRemoveMasterInfo rem;
    int id;
    snprintf(buf, sizeof buf, "%s pointer", name);
    id = find_device(buf, 1);
    if (id < 0) die("no such master pointer");
    rem.type = XIRemoveMaster;
    rem.deviceid = id;
    /* ⛔ Hand the slaves back to the core pair rather than floating them: a
     * floated physical device stops working for the human at the desk. */
    rem.return_mode = XIAttachToMaster;
    rem.return_pointer = 2;   /* Virtual core pointer  */
    rem.return_keyboard = 3;  /* Virtual core keyboard */
    if (XIChangeHierarchy(dpy, (XIAnyHierarchyChangeInfo *)&rem, 1) != Success)
        die("XIChangeHierarchy(remove) failed");
    XSync(dpy, False);
    printf("removed master pair \"%s\"\n", name);
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

static void cmd_move(const char *master, int x, int y) { warp(master, x, y); }

static void cmd_click(const char *master, int x, int y, int button)
{
    XDevice *p = open_xtest(master, "pointer");
    warp(master, x, y);
    XTestFakeDeviceButtonEvent(dpy, p, button, True,  NULL, 0, CurrentTime);
    XTestFakeDeviceButtonEvent(dpy, p, button, False, NULL, 0, CurrentTime);
    XSync(dpy, False);
    XCloseDevice(dpy, p);
}

static void cmd_type(const char *master, const char *text)
{
    XDevice *k = open_xtest(master, "keyboard");
    const unsigned char *s;
    for (s = (const unsigned char *)text; *s; s++) {
        char name[8];
        KeySym ks;
        KeyCode kc, shift;
        int need_shift = 0;
        if (*s == ' ') ks = XK_space;
        else if (*s == '\n') ks = XK_Return;
        else {
            snprintf(name, sizeof name, "%c", *s);
            ks = XStringToKeysym(name);
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

int main(int argc, char **argv)
{
    int major = 2, minor = 2, ev, err;
    if (argc < 2) {
        fprintf(stderr,
            "usage: agent-input <command>\n"
            "  list                         every input device, masters marked\n"
            "  create <name>                add a master pointer+keyboard pair\n"
            "  remove <name>                give its devices back to the core pair\n"
            "  move <name> <x> <y>          move THAT master's cursor\n"
            "  click <name> <x> <y> [btn]   warp and click with it (default button 1)\n"
            "  type <name> <text>           type with its keyboard\n"
            "  corepos                      where the operator's cursor is\n");
        return 2;
    }
    dpy = XOpenDisplay(NULL);
    if (!dpy) die("cannot open display (set DISPLAY)");
    if (!XQueryExtension(dpy, "XInputExtension", &major, &ev, &err))
        die("XInput extension missing");
    major = 2; minor = 2;
    if (XIQueryVersion(dpy, &major, &minor) != Success)
        die("XInput2 unavailable");

    if (!strcmp(argv[1], "list") && argc == 2) cmd_list();
    else if (!strcmp(argv[1], "create") && argc == 3) cmd_create(argv[2]);
    else if (!strcmp(argv[1], "remove") && argc == 3) cmd_remove(argv[2]);
    else if (!strcmp(argv[1], "move") && argc == 5) cmd_move(argv[2], atoi(argv[3]), atoi(argv[4]));
    else if (!strcmp(argv[1], "click") && (argc == 5 || argc == 6))
        cmd_click(argv[2], atoi(argv[3]), atoi(argv[4]), argc == 6 ? atoi(argv[5]) : 1);
    else if (!strcmp(argv[1], "type") && argc == 4) cmd_type(argv[2], argv[3]);
    else if (!strcmp(argv[1], "corepos") && argc == 2) cmd_corepos();
    else die("bad arguments — run with no arguments for usage");

    XCloseDisplay(dpy);
    return 0;
}
