import { type RefObject, useEffect, useState } from "react";

function findComposerActionsTarget(anchor: HTMLElement | null) {
  const editorCell = anchor?.closest<HTMLElement>("#advancedTextEditorCell");
  const sendButton = editorCell?.querySelector<HTMLElement>(
    '[data-testid="SendMessageButton"]',
  );
  const target = sendButton?.parentElement?.parentElement;
  return target instanceof HTMLElement ? target : null;
}

export function useComposerActionsTarget(
  anchorRef: RefObject<HTMLElement | null>,
) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const updateTarget = () =>
      setTarget(findComposerActionsTarget(anchorRef.current));
    updateTarget();

    const root =
      anchorRef.current?.closest<HTMLElement>("#advancedTextEditorCell") ??
      document.body;
    const observer = new MutationObserver(updateTarget);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [anchorRef]);

  return target;
}
