'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { User } from 'lucide-react'
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state'

export function UserProfileSheet() {
  const { data: userState } = useUserState()
  const updateUserState = useUpdateUserState()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (userState) {
      setDescription(userState.description)
    }
  }, [userState?.description]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (value: string) => {
      setDescription(value)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        updateUserState.mutate({ description: value })
      }, 500)
    },
    [updateUserState]
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
          aria-label="User profile"
        >
          <User size={14} />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:!max-w-2xl">
        <SheetHeader>
          <SheetTitle>Your Profile</SheetTitle>
          <SheetDescription>
            Describe yourself, your goals, and how you work. The AI uses this to personalize your experience.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 px-6 pb-6 overflow-y-auto pt-0.5">
          <textarea
            value={description}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="e.g. I'm a founder building a B2B SaaS product. I do my best deep work before noon. I tend to procrastinate on financial tasks..."
            className="w-full h-96 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          />
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            Auto-saved
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
