import React, { useEffect, useRef } from 'react';
import { TextInput } from '@inkjs/ui';

interface ControlledTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}

/**
 * Wrapper around @inkjs/ui TextInput to provide controlled behavior
 * Since @inkjs/ui uses uncontrolled components, we use key prop to force remount
 */
export function ControlledTextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
}: ControlledTextInputProps): React.ReactElement {
  const keyRef = useRef(0);

  // Force remount when value changes externally to keep it in sync
  useEffect(() => {
    keyRef.current += 1;
  }, [value]);

  return (
    <TextInput
      key={`${keyRef.current}-${value}`}
      defaultValue={value}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder={placeholder}
    />
  );
}
