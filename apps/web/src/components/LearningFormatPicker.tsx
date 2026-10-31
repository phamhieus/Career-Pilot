import { BookOpen, FolderKanban, Video } from 'lucide-react';
import { cx } from './ui';

export type LearningFormat = 'docs' | 'project' | 'youtube';
export const LEARNING_FORMATS = [
  { value: 'docs' as const, label: 'Documents', icon: BookOpen, description: 'Read guides and reference material, then practice.' },
  { value: 'project' as const, label: 'Hands-on project', icon: FolderKanban, description: 'Spend more time building, with reference material alongside.' },
  { value: 'youtube' as const, label: 'YouTube videos', icon: Video, description: 'Learn through YouTube lessons, then apply what you watch.' },
];

export function LearningFormatPicker({ value, onChange, disabled = false }: { value: LearningFormat; onChange: (v: LearningFormat) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="flex flex-col gap-2"><legend className="mb-2 text-body-sm font-medium">How do you prefer to learn?</legend>
    {LEARNING_FORMATS.map(({ value: format, label, description, icon: Icon }) => <label key={format} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border p-3', value === format ? 'border-primary bg-primary-soft' : 'border-line', disabled && 'cursor-default opacity-60')}>
      <input type="radio" name="learning-format" value={format} checked={value === format} onChange={() => onChange(format)} className="mt-1" /><Icon className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="block text-body-sm font-medium">{label}</span><span className="mt-1 block text-caption text-muted">{description}</span></span>
    </label>)}
  </fieldset>;
}
