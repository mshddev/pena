/**
 * Every shortcut in the app is described here so the hints a page prints and
 * the keys it listens for can never drift apart.
 */
interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Cmd+K on Apple platforms, Ctrl+K everywhere else. */
export function isSearchShortcut(event: ShortcutEvent): boolean {
  return (
    event.key.toLowerCase() === "k" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function searchShortcutLabel(): string {
  return isApplePlatform() ? "⌘K" : "Ctrl K";
}

/** Cmd+Shift+M — comment on whatever is selected. */
export function isCommentShortcut(event: ShortcutEvent): boolean {
  return (
    event.key.toLowerCase() === "m" &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey
  );
}

export function commentShortcutLabel(): string {
  return isApplePlatform() ? "⌘⇧M" : "Ctrl ⇧ M";
}

/** Cmd+Enter — save the comment being written. */
export function isSaveShortcut(event: ShortcutEvent): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function saveShortcutLabel(): string {
  return isApplePlatform() ? "⌘↵" : "Ctrl ↵";
}

/** Cmd+Shift+Enter — submit every draft at once. */
export function isSubmitAllShortcut(event: ShortcutEvent): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey
  );
}

export function submitAllShortcutLabel(): string {
  return isApplePlatform() ? "⌘⇧↵" : "Ctrl ⇧ ↵";
}

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
