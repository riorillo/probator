import * as fields from "../model/fields.ts";
import * as labels from "../model/labels.ts";
import * as report from "../model/report.ts";
import { useScreen } from "../store/hook.ts";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { Header } from "./Header.tsx";
import { HealNote } from "./HealNote.tsx";
import { PageFooter } from "./PageFooter.tsx";
import { TaskForm } from "./TaskForm.tsx";
import { TracePanel } from "./TracePanel.tsx";
import { Viewport } from "./Viewport.tsx";

/** The whole page. It reads the screen and hands each part of it to one component. */
export function App() {
  const screen = useScreen();
  const values = fields.filled(screen.values, screen.report);
  return (
    <>
      <Header />
      <main>
        <TaskForm
          values={values}
          model={report.textModel(screen.report, labels.NO_MODEL)}
          disabled={screen.busy}
          vision={screen.vision}
        />
        <ErrorBanner message={screen.fault} />
        <HealNote verdict={report.healVerdict(screen.report)} />
        <Viewport
          state={screen.report}
          running={screen.automatic}
          marked={screen.marking}
        />
        <TracePanel state={screen.report} />
        <PageFooter />
      </main>
    </>
  );
}
