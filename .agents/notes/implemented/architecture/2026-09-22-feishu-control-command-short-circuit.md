# Feishu control command short-circuit

The Feishu adapter resolves registered slash commands before enqueueing ordinary Agent follow-ups. This keeps mode changes, compaction, and other human commands out of the model loop. Unknown slash commands are consumed with an admission error, while only non-command text becomes a model-visible Feishu user message. A small resolver also maps unambiguous Chinese mode phrases to the existing `/mode` command.
