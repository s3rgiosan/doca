import { Pin } from './icons';

/** A pin that marks a pinned tab. It takes the text color. */
export function PinnedIcon() {
  return (
    <Pin class="pinned-icon" size={16} role="img" aria-label="Pinned">
      <title>Pinned</title>
    </Pin>
  );
}
