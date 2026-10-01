import { useEffect, useState } from "react";
import {
  defaultClientConfig,
  loadClientConfig,
  type VoiceMessagesClientConfig,
} from "./client_config_api";

export {
  defaultClientConfig,
  loadClientConfig,
  type VoiceMessagesClientConfig,
} from "./client_config_api";

export function useVoiceMessagesClientConfig(): {
  config: VoiceMessagesClientConfig;
  loading: boolean;
  error: string;
} {
  const [state, setState] = useState({
    config: defaultClientConfig,
    loading: true,
    error: "",
  });
  useEffect(() => {
    const controller = new AbortController();
    void loadClientConfig(controller.signal)
      .then((config) => {
        if (controller.signal.aborted) return;
        setState({ config, loading: false, error: "" });
      })
      .catch((configError: unknown) => {
        if (controller.signal.aborted) return;
        const error =
          configError instanceof Error
            ? configError.message
            : "Could not load voice message settings";
        console.warn(
          "[mattermost-voice-messages] Could not load plugin configuration",
          configError,
        );
        setState({ config: defaultClientConfig, loading: false, error });
      });
    return () => controller.abort();
  }, []);
  return state;
}
