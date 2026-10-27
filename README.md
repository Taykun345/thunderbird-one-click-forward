# Bulk Inline Forward

Thunderbird add-on to forward one or many emails to predefined forwarding configurations.

Based on One Click Forward by David Trapp (MIT, see LICENSE).

Set up forwarding configurations in settings, each with recipients, from identity, forward type, and a post-forward action (do nothing, archive, trash, or delete permanently).

## Single email

Use the message toolbar button "Quick Forward" to open a dropdown with your configurations and forward the displayed email with one click. Alt+Click the button to auto-forward using the first configuration.

If you hold Shift while clicking a configuration, the compose window stays open without sending, so you can make changes first. In that case the after-forwarding action is not executed.

## Bulk forward (multiple emails)

1. Select emails in the message list.
2. Right-click the selection and choose "Bulk Forward Selected", or use the toolbar button.
3. Pick a configuration and confirm. Every selected email is forwarded one by one, with a configurable delay between sends.

Ctrl+Shift+F and Alt+Click on the toolbar button use the first configuration. They open the confirmation popup unless confirmation is turned off in settings; a configuration that deletes permanently always asks.

## Safety

- Only one batch runs at a time.
- Exactly the confirmed messages are forwarded, including a right-clicked message outside the selection.
- Messages are sent immediately. If Thunderbird only queues a forward in the Outbox (offline / send later), the original is left untouched.
- A failing archive/trash/delete after a successful send is reported separately, so retrying never creates duplicates.
- The sender is stored as an identity id. A missing or ambiguous identity stops the forward instead of silently using another account.

## Features

- Multiple forwarding configurations
- Custom from identity per configuration
- Forward as inline or attachment
- Action after forwarding: do nothing / archive / trash / delete permanently
- Batch forwarding with progress, per-message error reporting and Outbox detection

## Download

Ready-made `.xpi` files are attached to the [Releases](../../releases). Install via Add-ons and Themes > gear icon > Install Add-on From File.

## Build

```
./build.sh
```

Produces `bulk-inline-forward-v<version>.xpi`.

GitHub Actions builds the `.xpi` on every push (run artifacts). To publish a release, bump `version` in `manifest.json`, commit, then push a matching tag:

```
git tag v1.1
git push origin v1.1
```
