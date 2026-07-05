import { useState, type FormEvent, type ReactNode } from 'react'
import { BrainCircuit, ChevronLeft, FolderOpen, Image, ListChecks, Plus, X, Zap } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import { cn } from '@/lib/utils'
import type { ComposerAbility } from '@modules/settings/composer-abilities'

export interface AddToChatSheetAbilities {
  items: ComposerAbility[]
  selectedIds: string[]
  onToggle: (abilityId: string) => void
  customAbilitiesEnabled: boolean
  onRemoveCustom: (abilityId: string) => void | Promise<void>
  onAddCustom: (label: string, prompt: string) => Promise<boolean>
  isSaving: boolean
  disabled?: boolean
}

export interface AddToChatSheetProps {
  open: boolean
  theme?: 'light' | 'dark'
  onClose: () => void
  onPickImage: () => void
  onPickSkill: () => void
  onPickFile: () => void
  abilities?: AddToChatSheetAbilities
}

interface AddToChatTileProps {
  label: string
  description: string
  ariaLabel: string
  onClick: () => void
  children: ReactNode
}

function AddToChatTile({
  label,
  description,
  ariaLabel,
  onClick,
  children,
}: AddToChatTileProps) {
  return (
    <button
      type="button"
      className="add-to-chat-sheet-tile"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className="add-to-chat-sheet-tile-icon" aria-hidden="true">
        {children}
      </span>
      <span className="add-to-chat-sheet-tile-label">{label}</span>
      <span className="add-to-chat-sheet-tile-description">{description}</span>
    </button>
  )
}

function abilityIcon(ability: ComposerAbility) {
  if (ability.id === 'think-hard') {
    return <BrainCircuit size={15} />
  }
  return <ListChecks size={15} />
}

export function AddToChatSheet({
  open,
  theme,
  onClose,
  onPickImage,
  onPickSkill,
  onPickFile,
  abilities,
}: AddToChatSheetProps) {
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')

  const showAbilities = Boolean(
    abilities && (abilities.items.length > 0 || abilities.customAbilitiesEnabled),
  )

  function handleClose() {
    setShowCustomForm(false)
    setCustomLabel('')
    setCustomPrompt('')
    onClose()
  }

  async function handleCustomAbilitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!abilities) {
      return
    }
    const added = await abilities.onAddCustom(customLabel, customPrompt)
    if (!added) {
      return
    }
    setCustomLabel('')
    setCustomPrompt('')
    setShowCustomForm(false)
  }

  return (
    <DismissibleOverlay
      open={open}
      onClose={handleClose}
      title="Add to Chat"
      position="bottom-sheet"
      portalThemeClassName={theme === 'dark' ? 'hv-dark' : theme === 'light' ? 'hv-light' : undefined}
      backdropClassName="sheet-backdrop--hervald add-to-chat-sheet-backdrop"
      contentClassName="sheet visible sheet--hervald add-to-chat-sheet"
      contentProps={{
        'aria-labelledby': 'add-to-chat-sheet-title',
        'data-testid': 'add-to-chat-sheet',
      }}
    >
      <div className="sheet-handle">
        <div className="sheet-handle-bar" />
      </div>

      <div className="add-to-chat-sheet-header">
        {showCustomForm ? (
          <button
            type="button"
            className="add-to-chat-sheet-close"
            onClick={() => setShowCustomForm(false)}
            aria-label="Back to add to chat"
          >
            <ChevronLeft size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="add-to-chat-sheet-close"
            onClick={handleClose}
            aria-label="Close add to chat"
          >
            <X size={16} />
          </button>
        )}

        <h2 id="add-to-chat-sheet-title" className="add-to-chat-sheet-title">
          {showCustomForm ? 'Custom ability' : 'Add to Chat'}
        </h2>
      </div>

      {showCustomForm && abilities ? (
        <form
          className="add-to-chat-sheet-custom-form"
          data-testid="add-to-chat-custom-ability-form"
          onSubmit={(event) => void handleCustomAbilitySubmit(event)}
        >
          <input
            value={customLabel}
            onChange={(event) => setCustomLabel(event.target.value)}
            placeholder="Ability name"
            aria-label="Custom ability name"
            maxLength={40}
            disabled={abilities.disabled || abilities.isSaving}
          />
          <textarea
            value={customPrompt}
            onChange={(event) => setCustomPrompt(event.target.value)}
            placeholder="Prompt instructions"
            aria-label="Custom ability prompt"
            rows={3}
            maxLength={4000}
            disabled={abilities.disabled || abilities.isSaving}
          />
          <div className="add-to-chat-sheet-custom-actions">
            <button
              type="button"
              onClick={() => setShowCustomForm(false)}
              disabled={abilities.isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="add-to-chat-sheet-custom-submit"
              disabled={
                abilities.isSaving
                || customLabel.trim().length === 0
                || customPrompt.trim().length === 0
              }
            >
              Add
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="add-to-chat-sheet-grid">
            <AddToChatTile
              label="Photos"
              description="Attach image files"
              ariaLabel="Add photos"
              onClick={() => {
                handleClose()
                onPickImage()
              }}
            >
              <Image size={18} />
            </AddToChatTile>

            <AddToChatTile
              label="Skills"
              description="Insert a skill command"
              ariaLabel="Add skills"
              onClick={() => {
                handleClose()
                onPickSkill()
              }}
            >
              <Zap size={18} />
            </AddToChatTile>

            <AddToChatTile
              label="Files"
              description="Open workspace picker"
              ariaLabel="Add files"
              onClick={() => {
                handleClose()
                onPickFile()
              }}
            >
              <FolderOpen size={18} />
            </AddToChatTile>
          </div>

          {showAbilities && abilities && (
            <div className="add-to-chat-sheet-toggles" data-testid="add-to-chat-ability-toggles">
              {abilities.items.map((ability) => {
                const selected = abilities.selectedIds.includes(ability.id)
                return (
                  <div key={ability.id} className="add-to-chat-sheet-toggle-row">
                    <span className="add-to-chat-sheet-toggle-icon" aria-hidden="true">
                      {abilityIcon(ability)}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={selected}
                      className="add-to-chat-sheet-toggle"
                      onClick={() => abilities.onToggle(ability.id)}
                      aria-label={`${selected ? 'Disable' : 'Enable'} ${ability.label} ability`}
                      disabled={abilities.disabled}
                    >
                      <span className="add-to-chat-sheet-toggle-label">{ability.label}</span>
                      <span
                        className={cn(
                          'add-to-chat-sheet-switch',
                          selected && 'add-to-chat-sheet-switch--on',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    {abilities.customAbilitiesEnabled && ability.source === 'custom' && (
                      <button
                        type="button"
                        className="add-to-chat-sheet-toggle-remove"
                        onClick={() => void abilities.onRemoveCustom(ability.id)}
                        aria-label={`Remove ${ability.label} ability`}
                        disabled={abilities.disabled || abilities.isSaving}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
              {abilities.customAbilitiesEnabled && (
                <div className="add-to-chat-sheet-toggle-row">
                  <span className="add-to-chat-sheet-toggle-icon" aria-hidden="true">
                    <Plus size={15} />
                  </span>
                  <button
                    type="button"
                    className="add-to-chat-sheet-toggle add-to-chat-sheet-toggle--action"
                    onClick={() => setShowCustomForm(true)}
                    aria-label="Add custom composer ability"
                    disabled={abilities.disabled}
                  >
                    <span className="add-to-chat-sheet-toggle-label">Custom ability</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </DismissibleOverlay>
  )
}
