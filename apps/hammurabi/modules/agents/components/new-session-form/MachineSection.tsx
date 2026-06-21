import type { AgentSession, Machine } from '@/types'
import { useState } from 'react'
import { AddWorkerWizard } from './AddWorkerWizard'
import { getMachineConnectionHost, getMachineDisplayValue } from './helpers'

interface MachineSectionProps {
  selectedMachineId: string
  setSelectedMachineId: (value: string) => void
  machines: Machine[]
  resumeLocked: boolean
  resumeSource: AgentSession | null
}

export function MachineSection({
  selectedMachineId,
  setSelectedMachineId,
  machines,
  resumeLocked,
  resumeSource,
}: MachineSectionProps) {
  const [showAddMachineWizard, setShowAddMachineWizard] = useState(false)
  const [showAuthWizard, setShowAuthWizard] = useState(false)
  const localMachine = machines.find((machine) => machine.id === 'local' || machine.host === null) ?? null
  const remoteMachines = machines.filter((machine) => machine.host)
  const selectedMachine = selectedMachineId
    ? machines.find((machine) => machine.id === selectedMachineId) ?? null
    : localMachine

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="section-title block">Machine</label>
        {!resumeLocked ? (
          <div className="flex items-center gap-2">
            {selectedMachine ? (
              <button
                type="button"
                onClick={() => setShowAuthWizard(true)}
                className="text-xs uppercase tracking-wide text-[color:var(--hv-fg-subtle)] underline underline-offset-2"
              >
                Provider auth
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowAddMachineWizard(true)}
              className="text-xs uppercase tracking-wide text-[color:var(--hv-fg-subtle)] underline underline-offset-2"
            >
              Add machine
            </button>
          </div>
        ) : null}
      </div>
      {resumeLocked ? (
        <div className="w-full rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-2 text-sm text-[color:var(--hv-fg)]">
          {getMachineDisplayValue(resumeSource, machines)}
        </div>
      ) : (
        <>
          <select
            value={selectedMachineId}
            onChange={(event) => setSelectedMachineId(event.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]"
          >
            <option value="">{localMachine?.label ?? 'Local (this server)'}</option>
            {remoteMachines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.label} ({machine.user ? `${machine.user}@` : ''}{getMachineConnectionHost(machine)})
              </option>
            ))}
          </select>

          <AddWorkerWizard
            open={showAddMachineWizard}
            onClose={() => setShowAddMachineWizard(false)}
            onMachineReady={(machine) => {
              setSelectedMachineId(machine.id)
              setShowAddMachineWizard(false)
            }}
          />

          <AddWorkerWizard
            open={showAuthWizard}
            onClose={() => setShowAuthWizard(false)}
            initialMachine={selectedMachine}
            onMachineReady={(machine) => {
              setSelectedMachineId(machine.host ? machine.id : '')
              setShowAuthWizard(false)
            }}
          />
        </>
      )}
    </div>
  )
}
