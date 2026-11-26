import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu"

describe("modal menu", () => {
  it("makes the page behind inert while open and gives focus back to the trigger", async () => {
    const user = userEvent.setup()
    const root = document.createElement("div")
    root.id = "root"
    document.body.appendChild(root)
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>One</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
      { container: root.appendChild(document.createElement("div")) },
    )
    const trigger = screen.getByRole("button", { name: "Open menu" })
    expect(root).not.toHaveAttribute("inert")
    await user.click(trigger)
    expect(await screen.findByRole("menu")).toBeInTheDocument()
    expect(root).toHaveAttribute("inert")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(root).not.toHaveAttribute("inert")
    await waitFor(() => expect(trigger).toHaveFocus())
    root.remove()
  })
})
