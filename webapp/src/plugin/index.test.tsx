import { ProjectLinks } from "../components/project_links";
import type { PluginRegistry } from "../types/mattermost-webapp";
import manifest from "./manifest";

describe("plugin admin console integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("registers the manifest custom row without replacing native settings", async () => {
    // Given the host registration boundary and the registry methods used by this plugin.
    const registerPlugin = vi.fn<Window["registerPlugin"]>();
    vi.stubGlobal("registerPlugin", registerPlugin);
    const registry = {
      registerAdminConsoleCustomSetting:
        vi.fn<PluginRegistry["registerAdminConsoleCustomSetting"]>(),
      registerPostEditorActionComponent:
        vi.fn<PluginRegistry["registerPostEditorActionComponent"]>(),
      registerPostTypeComponent:
        vi.fn<PluginRegistry["registerPostTypeComponent"]>(),
      registerFilePreviewComponent:
        vi.fn<PluginRegistry["registerFilePreviewComponent"]>(),
      registerPostMessageAttachmentComponent:
        vi.fn<PluginRegistry["registerPostMessageAttachmentComponent"]>(),
      registerAdminConsolePlugin:
        vi.fn<PluginRegistry["registerAdminConsolePlugin"]>(),
    } satisfies Pick<
      PluginRegistry,
      | "registerAdminConsoleCustomSetting"
      | "registerPostEditorActionComponent"
      | "registerPostTypeComponent"
      | "registerFilePreviewComponent"
      | "registerPostMessageAttachmentComponent"
      | "registerAdminConsolePlugin"
    >;

    // When Mattermost loads and initializes the real plugin entry point.
    await import("./index");
    const registration = registerPlugin.mock.calls[0];
    if (!registration) throw new Error("Expected plugin registration");
    const [pluginId, plugin] = registration;
    Reflect.apply(plugin.initialize, plugin, [registry]);

    // Then the declared custom setting is mounted in the native settings page.
    expect(pluginId).toBe(manifest.id);
    expect(
      registry.registerAdminConsoleCustomSetting,
    ).toHaveBeenCalledExactlyOnceWith("ProjectLinks", ProjectLinks, {
      showTitle: false,
    });
    expect(registry.registerAdminConsolePlugin).not.toHaveBeenCalled();
    expect(manifest.settings_schema.header).toBe("");
    expect(manifest.settings_schema.settings[0]).toMatchObject({
      key: "ProjectLinks",
      type: "custom",
      default: "",
      help_text: "",
    });
  });
});
