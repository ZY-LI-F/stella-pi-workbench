import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionDialog } from "@renderer/components/ExtensionDialog";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ExtensionDialog", () => {
  it("submits explicit confirmation responses", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(
      <ExtensionDialog
        request={{ type: "extension_ui_request", id: "confirm-1", method: "confirm", title: "继续？", message: "确认执行" }}
        onRespond={onRespond}
        onExpire={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "确认" }));
    expect(onRespond).toHaveBeenCalledWith({
      type: "extension_ui_response",
      id: "confirm-1",
      confirmed: true,
    });
  });

  it("dismisses a request locally when its Pi timeout elapses", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(
      <ExtensionDialog
        request={{ type: "extension_ui_request", id: "input-1", method: "input", title: "输入", timeout: 500 }}
        onRespond={vi.fn()}
        onExpire={onExpire}
      />,
    );

    act(() => vi.advanceTimersByTime(500));
    expect(onExpire).toHaveBeenCalledWith("input-1");
  });
});
