export function refreshMapNoteWorkflow(ui) {
  if (typeof document === 'undefined' || !ui.projectManager.mapNotes?.getWorkflowSummary) return;
  document.querySelectorAll('[data-note-workflow]').forEach(element => {
    try {
      const result = ui.projectManager.mapNotes.getWorkflowSummary(element.dataset.noteWorkflow);
      element.textContent = result.taskCount ? `Field task status: ${result.completed}/${result.taskCount} reported completed · ${result.returned}/${result.taskCount} reported returned${result.outstanding ? ` · ${result.outstanding} outstanding` : ''}${result.missing ? ` · ${result.missing} unavailable` : ''}${result.unknown ? ` · ${result.unknown} unknown status` : ''}. These are current task statuses, not audited events. Completion does not verify or resolve this note.` : 'No linked field tasks.';
    } catch { element.textContent = 'Workflow status unavailable.'; }
  });
}
