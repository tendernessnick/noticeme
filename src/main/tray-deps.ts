export interface TrayDeps {
  showMain(): void
  onQuickAdd(): void
  onQuit(): void
  getTodayCount(): number
  getAutoStart(): boolean
  toggleAutoStart(): void
}
