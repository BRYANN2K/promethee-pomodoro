#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>

#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static NSString *const PrometheeBundleIdentifier = @"app.promethee";

static void receipt(const char *value) {
  fputs(value, stdout);
  fputc('\n', stdout);
}

static bool parseInteger(const char *value, long long *output) {
  if (value == NULL || value[0] == '\0') return false;
  errno = 0;
  char *end = NULL;
  const long long parsed = strtoll(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0') return false;
  *output = parsed;
  return true;
}

static NSArray<NSRunningApplication *> *prometheeApplications(void) {
  return [NSRunningApplication runningApplicationsWithBundleIdentifier:PrometheeBundleIdentifier];
}

static bool exactIntegerRect(CGRect bounds, long long x, long long y, long long width, long long height) {
  return llround(CGRectGetMinX(bounds)) == x &&
    llround(CGRectGetMinY(bounds)) == y &&
    llround(CGRectGetWidth(bounds)) == width &&
    llround(CGRectGetHeight(bounds)) == height;
}

static NSArray<NSDictionary *> *windowSnapshot(void) {
  CFArrayRef snapshot = CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID
  );
  return CFBridgingRelease(snapshot);
}

static bool windowBounds(NSDictionary *record, CGRect *output) {
  NSDictionary *dictionary = record[(id)kCGWindowBounds];
  return dictionary != nil && CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)dictionary, output);
}

static int commandPid(void) {
  NSArray<NSRunningApplication *> *applications = prometheeApplications();
  if (applications.count == 0) {
    receipt("process-not-found");
    return 2;
  }
  if (applications.count != 1) {
    receipt("process-ambiguous");
    return 2;
  }
  printf("%d\n", applications.firstObject.processIdentifier);
  return 0;
}

static int commandWindows(void) {
  NSArray<NSRunningApplication *> *applications = prometheeApplications();
  if (applications.count == 0) {
    receipt("process-not-found");
    return 2;
  }
  if (applications.count != 1) {
    receipt("process-ambiguous");
    return 2;
  }

  const pid_t processIdentifier = applications.firstObject.processIdentifier;
  NSUInteger emitted = 0;
  for (NSDictionary *record in windowSnapshot()) {
    if ([record[(id)kCGWindowOwnerPID] intValue] != processIdentifier) continue;
    CGRect bounds = CGRectZero;
    if (!windowBounds(record, &bounds)) continue;
    const long long x = llround(CGRectGetMinX(bounds));
    const long long y = llround(CGRectGetMinY(bounds));
    const long long width = llround(CGRectGetWidth(bounds));
    const long long height = llround(CGRectGetHeight(bounds));
    if (width <= 0 || height <= 0 || width > INT_MAX || height > INT_MAX) continue;
    printf("%lld,%lld,%lld,%lld\n", x, y, width, height);
    emitted += 1;
    if (emitted >= 128) break;
  }
  return 0;
}

static int commandPermissions(bool request) {
  bool inputGranted = CGPreflightPostEventAccess();
  if (request && !inputGranted) inputGranted = CGRequestPostEventAccess();

  bool captureGranted = CGPreflightScreenCaptureAccess();
  if (request && !captureGranted) captureGranted = CGRequestScreenCaptureAccess();

  printf("permissions,%d,%d\n", inputGranted ? 1 : 0, captureGranted ? 1 : 0);
  return inputGranted && captureGranted ? 0 : 3;
}

static int commandClick(int argc, const char *argv[]) {
  if (argc != 13) {
    receipt("invalid-action");
    return 2;
  }

  const char *action = argv[2];
  const char *expectedState = argv[3];
  const bool pause = strcmp(action, "pause") == 0;
  const bool resume = strcmp(action, "resume") == 0;
  if ((!pause && !resume) ||
      (pause && strcmp(expectedState, "running") != 0) ||
      (resume && strcmp(expectedState, "paused") != 0)) {
    receipt("state-mismatch");
    return 2;
  }

  long long values[9] = {0};
  for (int index = 0; index < 9; index += 1) {
    if (!parseInteger(argv[index + 4], &values[index])) {
      receipt("invalid-action");
      return 2;
    }
  }
  const long long expectedPid = values[0];
  const long long expectedX = values[1];
  const long long expectedY = values[2];
  const long long expectedWidth = values[3];
  const long long expectedHeight = values[4];
  const long long expectedGeneration = values[5];
  const long long targetX = values[6];
  const long long targetY = values[7];
  const long long controlCount = values[8];

  if (expectedPid <= 0 || expectedPid > INT_MAX || expectedGeneration < 0 ||
      expectedWidth < 120 || expectedWidth > 220 || expectedHeight != 32) {
    receipt("target-mismatch");
    return 2;
  }
  if ((pause && controlCount != 2) || (resume && controlCount != 3)) {
    receipt("state-mismatch");
    return 2;
  }
  const long long expectedTargetX = expectedX + expectedWidth - 1 - (pause ? 50 : 82);
  const long long expectedTargetY = expectedY + 16;
  if (targetX != expectedTargetX || targetY != expectedTargetY) {
    receipt("target-mismatch");
    return 2;
  }

  NSArray<NSRunningApplication *> *applications = prometheeApplications();
  if (applications.count == 0) {
    receipt("process-not-found");
    return 2;
  }
  if (applications.count != 1) {
    receipt("process-ambiguous");
    return 2;
  }
  if (applications.firstObject.processIdentifier != (pid_t)expectedPid) {
    receipt("process-changed");
    return 2;
  }

  NSUInteger matchingWindows = 0;
  for (NSDictionary *record in windowSnapshot()) {
    if ([record[(id)kCGWindowOwnerPID] intValue] != (pid_t)expectedPid) continue;
    CGRect bounds = CGRectZero;
    if (windowBounds(record, &bounds) && exactIntegerRect(bounds, expectedX, expectedY, expectedWidth, expectedHeight)) {
      matchingWindows += 1;
    }
  }
  if (matchingWindows == 0) {
    receipt("timer-not-found");
    return 2;
  }
  if (matchingWindows != 1) {
    receipt("timer-ambiguous");
    return 2;
  }

  if (!CGPreflightPostEventAccess()) {
    receipt("permission-denied");
    return 3;
  }

  CGEventRef probe = CGEventCreate(NULL);
  if (probe == NULL) {
    receipt("click-failed");
    return 4;
  }
  const CGPoint originalPosition = CGEventGetLocation(probe);
  CFRelease(probe);
  const CGPoint target = CGPointMake((CGFloat)targetX, (CGFloat)targetY);
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  CGEventRef down = CGEventCreateMouseEvent(source, kCGEventLeftMouseDown, target, kCGMouseButtonLeft);
  CGEventRef up = CGEventCreateMouseEvent(source, kCGEventLeftMouseUp, target, kCGMouseButtonLeft);
  if (source == NULL || down == NULL || up == NULL) {
    if (down != NULL) CFRelease(down);
    if (up != NULL) CFRelease(up);
    if (source != NULL) CFRelease(source);
    receipt("click-failed");
    return 4;
  }

  CGEventSetIntegerValueField(down, kCGMouseEventClickState, 1);
  CGEventSetIntegerValueField(up, kCGMouseEventClickState, 1);
  CGEventPost(kCGHIDEventTap, down);
  usleep(12000);
  CGEventPost(kCGHIDEventTap, up);
  usleep(50000);
  CGEventRef restore = CGEventCreateMouseEvent(source, kCGEventMouseMoved, originalPosition, kCGMouseButtonLeft);
  if (restore != NULL) {
    CGEventPost(kCGHIDEventTap, restore);
    CFRelease(restore);
  }
  CFRelease(down);
  CFRelease(up);
  CFRelease(source);

  printf("clicked-unconfirmed,%s,%lld\n", action, expectedGeneration);
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 2 && strcmp(argv[1], "self-test") == 0) {
      receipt("ready,1,pause-resume");
      return 0;
    }
    if (argc == 2 && strcmp(argv[1], "permission-status") == 0) return commandPermissions(false);
    if (argc == 2 && strcmp(argv[1], "permissions") == 0) return commandPermissions(true);
    if (argc == 2 && strcmp(argv[1], "pid") == 0) return commandPid();
    if (argc == 2 && strcmp(argv[1], "windows") == 0) return commandWindows();
    if (argc >= 2 && strcmp(argv[1], "click") == 0) return commandClick(argc, argv);
    receipt("invalid-command");
    return 2;
  }
}
