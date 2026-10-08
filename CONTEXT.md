# Cadencr Extensibility

Cadencr users create local plugins in their own Cadencr instance. Sharing a
plugin is a separate, later workflow from creating and using it locally.

## Language

### Plugin

An extension authored for Cadencr. The local delivery scope includes themes and
provider connectors; a plugin does not inherently grant general UI extension powers.

### Plugin project

A developer's Cadencr project dedicated to authoring an identifiable plugin,
either a theme or a provider connector. Its identity persists independently of
its display name or folder, so it can later enter the publication workflow.

### Provider connector

A plugin that adapts an agent to Cadencr's supported provider contract. It is
not the upstream agent itself and is distinct from an installation of that plugin.

### Theme

A plugin defining Cadencr's visual appearance through supported theme values.
Its authoring project is distinct from the theme selected in the application.

### Publication

The workflow that publishes a plugin version to its GitHub repository and
submits that initial or subsequent version to the Cadencr registry.

### Registry

The catalog of approved plugin identities and versions available for distribution.
It is not the list of local plugin projects or the list of installed plugins.
