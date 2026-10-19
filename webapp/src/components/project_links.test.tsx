import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { ProjectLinks } from "./project_links";

afterEach(cleanup);

describe("ProjectLinks", () => {
  it("renders accessible external project links", () => {
    // Given a display-only setting mounted by the admin console.
    render(<ProjectLinks />);

    // When finding the links through their accessible names.
    const section = screen.getByRole("region", { name: "Project links" });
    const links = within(section).getAllByRole("link");

    // Then both destinations are safe to open in a separate tab.
    expect(links).toHaveLength(2);
    expect(
      within(section).getByRole("link", { name: "@icoretech_inc" }),
    ).toHaveAttribute("href", "https://x.com/icoretech_inc");
    expect(
      within(section).getByRole("link", {
        name: "icoretech/mattermost-voice-messages",
      }),
    ).toHaveAttribute(
      "href",
      "https://github.com/icoretech/mattermost-voice-messages",
    );
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("leaves native setting values and form submission unchanged", () => {
    // Given an existing settings form with its own change and save handlers.
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.SubmitEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    const { container } = render(
      <form onChange={onChange} onSubmit={onSubmit}>
        <ProjectLinks />
        <input
          aria-label="Recording limit"
          name="MaxRecordingDurationSeconds"
          defaultValue="21600"
        />
        <button type="submit">Save</button>
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Expected the native settings form");

    // When the native Save button is activated with the banner present.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then the banner neither changes configuration nor adds a submitted value.
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(Array.from(new FormData(form).entries())).toEqual([
      ["MaxRecordingDurationSeconds", "21600"],
    ]);
  });
});
