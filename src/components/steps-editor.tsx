export type StepDraft = { instruction: string; completionCondition: string; required: boolean };

export function StepsEditor({ steps, onChange }: { steps: StepDraft[]; onChange: (steps: StepDraft[]) => void }) {
  function update(index: number, changes: Partial<StepDraft>) {
    onChange(steps.map((step, current) => current === index ? { ...step, ...changes } : step));
  }

  return <div className="step-editor">
    {steps.map((step, index) => <fieldset className="step-editor-card" key={index}>
      <div className="step-editor-heading">
        <span className="step-number">{index + 1}</span>
        <strong>Step {index + 1}</strong>
        <button className="icon-button" type="button" aria-label={`Rimuovi step ${index + 1}`} disabled={steps.length === 1} onClick={() => onChange(steps.filter((_, current) => current !== index))}>×</button>
      </div>
      <label className="field">Azione da eseguire
        <textarea required rows={2} maxLength={2000} value={step.instruction} onChange={(event) => update(index, { instruction: event.target.value })} placeholder="Es. Apri il menu e seleziona Impostazioni" />
      </label>
      <label className="field">Condizione di completamento
        <textarea required rows={2} maxLength={2000} value={step.completionCondition} onChange={(event) => update(index, { completionCondition: event.target.value })} placeholder="Es. La pagina Impostazioni è aperta e mostra le preferenze dell’account" />
      </label>
    </fieldset>)}
    <button className="button add-step" type="button" onClick={() => onChange([...steps, { instruction: "", completionCondition: "", required: true }])}>＋ Aggiungi step</button>
  </div>;
}
