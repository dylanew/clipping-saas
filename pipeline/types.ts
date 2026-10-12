export interface Word { word: string; start: number; end: number }
export interface Segment { start: number; end: number; text: string }
export interface Transcript { duration: number; segments: Segment[]; words: Word[] }
