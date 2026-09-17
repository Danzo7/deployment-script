export class CommandHistory {
  private entries: string[] = [];
  private cursor: number = -1;

  add(line: string): void {
    if (line.trim().length === 0) return;
    // Don't add duplicates of the last command
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === line) {
      this.cursor = -1;
      return;
    }
    this.entries.push(line);
    this.cursor = -1;
  }

  previous(currentInput: string): string | null {
    if (this.entries.length === 0) return null;
    
    // First up-arrow from fresh prompt
    if (this.cursor === -1) {
      this.cursor = this.entries.length - 1;
      return this.entries[this.cursor];
    }
    
    // Already navigating, go further back
    if (this.cursor > 0) {
      this.cursor--;
      return this.entries[this.cursor];
    }
    
    return this.entries[this.cursor];
  }

  next(): string | null {
    if (this.cursor === -1) return null;
    
    if (this.cursor < this.entries.length - 1) {
      this.cursor++;
      return this.entries[this.cursor];
    }
    
    // Reached the end, return to fresh prompt
    this.cursor = -1;
    return '';
  }

  reset(): void {
    this.cursor = -1;
  }
}
