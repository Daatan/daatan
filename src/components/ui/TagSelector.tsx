'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Plus, Search } from 'lucide-react'

interface TagSelectorProps {
    selectedTags: string[]
    onChange: (tags: string[]) => void
    suggestions?: string[]
    maxTags?: number
    placeholder?: string
}

import { STANDARD_TAGS } from '@/lib/constants'

export function TagSelector({
    selectedTags,
    onChange,
    suggestions = STANDARD_TAGS,
    maxTags = 5,
    placeholder = "Add a tag..."
}: TagSelectorProps) {
    const [inputValue, setInputValue] = useState('')
    const [showSuggestions, setShowSuggestions] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setShowSuggestions(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside, { passive: true })
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [wrapperRef])

    const filteredSuggestions = suggestions.filter(
        tag =>
            tag.toLowerCase().includes(inputValue.toLowerCase()) &&
            !selectedTags.includes(tag)
    )

    const addTag = (tag: string) => {
        if (selectedTags.length >= maxTags) return
        if (!selectedTags.includes(tag)) {
            onChange([...selectedTags, tag])
        }
        setInputValue('')
        setShowSuggestions(false)
    }

    const removeTag = (tagToRemove: string) => {
        onChange(selectedTags.filter(tag => tag !== tagToRemove))
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (inputValue.trim()) {
                addTag(inputValue.trim())
            }
        } else if (e.key === 'Backspace' && !inputValue && selectedTags.length > 0) {
            removeTag(selectedTags[selectedTags.length - 1])
        }
    }

    return (
        <div className="w-full" ref={wrapperRef}>
            <div className="flex flex-wrap gap-2 p-2 border border-navy-600 rounded-xl bg-navy-700 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-shadow">
                {selectedTags.map(tag => (
                    <span
                        key={tag}
                        className="flex items-center gap-1 px-2.5 py-1 bg-cobalt/10 text-cobalt-light rounded-full text-sm font-medium animate-in fade-in zoom-in duration-200"
                    >
                        {tag}
                        <button
                            onClick={() => removeTag(tag)}
                            aria-label={`Remove ${tag}`}
                            className="text-blue-400 hover:text-blue-600 focus:outline-none"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                ))}

                <div className="relative flex-1 min-w-[120px]">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={e => {
                            setInputValue(e.target.value)
                            setShowSuggestions(true)
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={handleKeyDown}
                        placeholder={selectedTags.length === 0 ? placeholder : ""}
                        aria-label={placeholder}
                        className="w-full h-8 bg-transparent focus:outline-none text-sm"
                        disabled={selectedTags.length >= maxTags}
                    />

                    {showSuggestions && inputValue && filteredSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 mt-2 w-full bg-navy-700 border border-navy-600 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
                            {filteredSuggestions.map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => addTag(tag)}
                                    className="w-full text-left px-4 py-2 text-sm hover:bg-navy-800 flex items-center gap-2"
                                >
                                    <Plus className="w-3 h-3 text-gray-400" />
                                    {tag}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Popular tags limit hint */}
            {selectedTags.length >= maxTags && (
                <p className="text-xs text-amber-600 mt-1">Maximum {maxTags} tags allowed</p>
            )}
        </div>
    )
}
