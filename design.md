# Interaction design

- Minimize configuration and required user input. Use sensible defaults and infer context wherever possible.
- Never use multi-step forms for basic actions. Submitting a form completes the action; it must not open another configuration prompt.
- Creating a workspace asks only for its name and inherits the current workspace's default folder.
- Right-clicking a workspace edits only its name. Saving completes the rename immediately, without a folder prompt.
- Keep optional configuration out of the normal creation and rename flows.
- Persist workspace names, default folders, and selection automatically across Corgi restarts. Do not require an explicit save or setup step.
