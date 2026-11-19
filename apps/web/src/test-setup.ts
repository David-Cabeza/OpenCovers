import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { useUiStore } from "@/stores/ui-store";

afterEach(cleanup);

// The tests read English, whatever the language of the machine they run on. A test of Spanish sets its own.
beforeEach(() => useUiStore.setState({ locale: "en" }));
