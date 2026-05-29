/**
 * Shared toggle switch used across AccessSettings sections.
 */

interface ToggleProps {
  enabled: boolean;
  disabled?: boolean;
  onChange: () => void;
}

export default function Toggle({ enabled, disabled, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      className={`w-8 h-5 rounded-full transition-colors relative ${
        enabled ? 'bg-green-500' : 'bg-dark-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
        enabled ? 'left-[14px]' : 'left-0.5'
      }`} />
    </button>
  );
}
