import React, { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerImage } from "@renderer/components/Composer";

afterEach(cleanup);

function ComposerHarness({
  streaming = false,
  onSend = vi.fn().mockResolvedValue(undefined),
  onStop = vi.fn(),
  onQueueModeChange = vi.fn(),
}: {
  readonly streaming?: boolean;
  readonly onSend?: (message: string, images: readonly ComposerImage[]) => Promise<void>;
  readonly onStop?: () => void;
  readonly onQueueModeChange?: (mode: "steer" | "followUp") => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <Composer
      draft={draft}
      onDraftChange={setDraft}
      commands={[{ name: "review", description: "审查改动", source: "prompt" }]}
      widgets={{}}
      streaming={streaming}
      queueMode="steer"
      onQueueModeChange={onQueueModeChange}
      onSend={onSend}
      onStop={onStop}
      onOpenTerminal={vi.fn()}
      onOpenPalette={vi.fn()}
      onError={vi.fn()}
    />
  );
}

describe("Composer", () => {
  it("submits with Enter and clears the draft only after success", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ComposerHarness onSend={onSend} />);
    const input = screen.getByLabelText("给 Pi 的消息");

    await user.type(input, "检查当前改动{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("检查当前改动", []));
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("inserts slash commands and exposes streaming controls", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const onQueueModeChange = vi.fn();
    render(<ComposerHarness streaming onStop={onStop} onQueueModeChange={onQueueModeChange} />);
    const input = screen.getByLabelText("给 Pi 的消息");

    await user.type(input, "/rev");
    await user.click(screen.getByRole("button", { name: /\/review/ }));
    expect((input as HTMLTextAreaElement).value).toBe("/review ");
    await user.click(screen.getByRole("button", { name: "排队" }));
    expect(onQueueModeChange).toHaveBeenCalledWith("followUp");
    await user.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
