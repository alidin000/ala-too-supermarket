import type { ComponentProps } from 'react'
import { Dialog } from '../../components/Dialog'
import { useStaff } from '../context'

/** The shared Dialog, with the staff shell made inert behind it. */
export function StaffDialog(props: Omit<ComponentProps<typeof Dialog>, 'inertTarget'>) {
  const { getShell } = useStaff()
  return (
    <Dialog
      {...props}
      className={['staff-dialog', props.className].filter(Boolean).join(' ')}
      inertTarget={getShell}
    />
  )
}
