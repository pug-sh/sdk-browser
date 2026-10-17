# `frustration.ts` — rage and dead clicks

Both trackers judge what the user did, not raw `click` events. A browser fires more `click` events
than the user makes in two ways — label forwarding and multi-click gestures — and each produced false
frustration signals.

---

## A label click is one click

Clicking a `<label>` makes the browser fire a second `click` at its control, at the same coordinates.
Counted raw, ticking then unticking a checkbox through its label was a rage click, and the label click
itself was a dead click — toggling a checkbox mutates no DOM.

`forwarded-click.ts` recognizes the forward as the next click, aimed at the label's `control`, at the
label click's exact coordinates, within the same task: browsers forward synchronously, inside the
label click's dispatch. The expectation expires with that task, because a label click is not always
forwarded — the page may cancel it, it may land on a link inside the label, or it may end a
drag-selection — and keyboard clicks all sit at (0, 0), so coordinates alone let the next keyboard
click on the control pass for a forward. The target comes from `composedPath()`, so a label inside an
open shadow root is found; one inside a closed root is not.

Both trackers drop the forward. The dead-click tracker takes it as the label click's response when the
control is a form field, which toggles or takes focus, and the page did not cancel it. A label for a
`<button>` is answered only by what the button does.

The `click` tracker keeps both events. They describe two elements, and only the control's click
carries its `id`, which anything counting a checkbox by id needs.

## Why rage needs four clicks

A triple-click — how a paragraph, or an input's whole value, is selected — is three `click` events at
one spot well inside a second. At a threshold of three, copying an order number was a rage click, and
so was a double-click plus one more click. Four is one more than the longest native multi-click
gesture.

A selection-aware threshold was rejected: Chrome reports an `<input>`'s selection through
`getSelection()` as collapsed, so a triple-click inside a field would still have been rage.

## Why `rage_click` is sent as soon as the burst qualifies

Once per burst, so a sustained burst is no longer re-reported each time a cooldown lapses. Waiting
for the burst to end would give the full click count, but clicking that ends in a navigation — the
slow button that finally responds — would lose the event on a page load, and on an SPA route change
stamp it with the next page's `$url`. So `clickCount` is the clicks counted when the burst qualified:
four, or more when slower clicks at the same spot led into it.

## A double or triple click is one dead-click gesture

A click whose `detail` says it continues a multi-click joins that gesture, which is judged once, 500ms
after its last click. It joins even when it lands on another element, since the first click may have
replaced the element under the pointer or navigated. A rage burst is one `dead_click`, not one per
click.

## Selecting text is a response

A selection is not a DOM mutation, so every click of a double or triple click on text, and the click
ending a drag-selection, was a dead click. Every click on text also moves the invisible caret and
fires `selectionchange`, though, so counting any change would hide every dead click on text. Two
signals count instead: a highlighted selection whose anchor or focus is in the target when the gesture
is judged, and a `selectionchange` to or from a highlighted selection during the wait. The second
catches a press inside a highlight, which Chromium clears only after the click; a press elsewhere
clears it before, inside the baseline.

Neither signal counts once a gesture reaches four clicks: no native gesture selects with four, so a
rage burst on a `<div>` with selectable text is still one `dead_click`. Below four the trade-off
stands — a double-click that selects a word, or a press that clears a highlight, cannot be told apart
from selecting text, so a dead element under either goes unreported.

Anchor and focus, not `Selection.containsNode`: a highlight that merely spans the target, like a
selected paragraph around a dead `<button>`, must not hide a dead click on it, and jsdom's partial
`containsNode` departs from the spec anyway.
