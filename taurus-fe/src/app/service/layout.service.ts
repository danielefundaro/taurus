import { computed, effect, Injectable, signal } from '@angular/core';
import { first, of, Subject, switchMap } from 'rxjs';
import { Preferences, PreferencesCriteria } from '../module';
import { LocalStorageService } from './local-storage.service';
import { PreferencesService } from './preferences.service';
import { TenantStatusService } from './tenant-status.service';

export interface LayoutConfig {
    preset?: string;
    primary?: string;
    surface?: string | null;
    darkTheme?: boolean;
    menuMode?: string;
}

interface LayoutState {
    staticMenuDesktopInactive?: boolean;
    overlayMenuActive?: boolean;
    configSidebarVisible?: boolean;
    staticMenuMobileActive?: boolean;
    menuHoverActive?: boolean;
}

interface MenuChangeEvent {
    key: string;
    routeEvent?: boolean;
}

/** Il valore come si salva fra le preferenze: `null` e la stringa vuota sono la stessa scelta. */
const storedValue = (value: unknown): string => (value == null ? '' : String(value));

/** Due configurazioni sono uguali quando lo sono i valori che se ne salvano. */
const sameLayoutConfig = (a: LayoutConfig, b: LayoutConfig): boolean => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof LayoutConfig)[]);
    return [...keys].every((key) => storedValue(a[key]) === storedValue(b[key]));
};

@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    _config: LayoutConfig = {
        preset: 'Aura',
        primary: 'emerald',
        surface: null,
        darkTheme: false,
        menuMode: 'static'
    };

    _state: LayoutState = {
        staticMenuDesktopInactive: false,
        overlayMenuActive: false,
        configSidebarVisible: false,
        staticMenuMobileActive: false,
        menuHoverActive: false
    };

    /**
     * All'avvio le preferenze del server e il configuratore riscrivono la configurazione con i
     * valori che ha già: quelle scritture non notificano, altrimenti ogni pagina partirebbe con la
     * transizione del tema, che per mezzo secondo copre la pagina e ne intercetta i clic.
     */
    layoutConfig = signal<LayoutConfig>(this._config, { equal: sameLayoutConfig });

    layoutState = signal<LayoutState>(this._state);

    private readonly configUpdate = new Subject<LayoutConfig>();

    private readonly overlayOpen = new Subject<any>();

    private readonly menuSource = new Subject<MenuChangeEvent>();

    private readonly resetSource = new Subject();

    private transitionRunning = false;

    menuSource$ = this.menuSource.asObservable();

    resetSource$ = this.resetSource.asObservable();

    configUpdate$ = this.configUpdate.asObservable();

    overlayOpen$ = this.overlayOpen.asObservable();

    theme = computed(() => (this.layoutConfig()?.darkTheme ? 'light' : 'dark'));

    isSidebarActive = computed(() => this.layoutState().overlayMenuActive || this.layoutState().staticMenuMobileActive);

    isDarkTheme = computed(() => this.layoutConfig().darkTheme);

    getPrimary = computed(() => this.layoutConfig().primary);

    getSurface = computed(() => this.layoutConfig().surface);

    isOverlay = computed(() => this.layoutConfig().menuMode === 'overlay');

    transitionComplete = signal<boolean>(false);

    private initialized = false;

    notificationNumber = signal<number>(0);

    constructor(
        private readonly preferencesService: PreferencesService,
        private readonly localStorageService: LocalStorageService,
        private readonly tenantStatus: TenantStatusService
    ) {
        effect(() => {
            const config = this.layoutConfig();

            if (config) {
                this.onConfigUpdate();
                this.saveConfig(config);
            }
        });

        effect(() => {
            const state = this.layoutState();

            if (state) {
                this.saveConfig(state);
            }
        })

        effect(() => {
            const config = this.layoutConfig();

            if (!this.initialized || !config) {
                this.initialized = true;
                return;
            }

            this.handleDarkModeTransition(config);
        });
    }

    private handleDarkModeTransition(config: LayoutConfig): void {
        if ((document as any).startViewTransition) {
            this.startViewTransition(config);
        } else {
            this.toggleDarkMode(config);
            this.onTransitionEnd();
        }
    }

    private startViewTransition(config: LayoutConfig): void {
        if (this.transitionRunning) {
            this.toggleDarkMode(config);
            return;
        }

        this.transitionRunning = true;

        const transition = document.startViewTransition(() => {
            this.toggleDarkMode(config);
        });

        transition.finished.finally(() => {
            this.transitionRunning = false;
            this.onTransitionEnd();
        });
    }

    toggleDarkMode(config?: LayoutConfig): void {
        const _config = config || this.layoutConfig();
        if (_config.darkTheme) {
            document.documentElement.classList.add('app-dark');
        } else {
            document.documentElement.classList.remove('app-dark');
        }
    }

    private onTransitionEnd() {
        this.transitionComplete.set(true);
        setTimeout(() => {
            this.transitionComplete.set(false);
        });
    }

    onMenuToggle() {
        if (this.isOverlay()) {
            this.layoutState.update((prev) => ({ ...prev, overlayMenuActive: !this.layoutState().overlayMenuActive }));

            if (this.layoutState().overlayMenuActive) {
                this.overlayOpen.next(null);
            }
        }

        if (this.isDesktop()) {
            this.layoutState.update((prev) => ({ ...prev, staticMenuDesktopInactive: !this.layoutState().staticMenuDesktopInactive }));
        } else {
            this.layoutState.update((prev) => ({ ...prev, staticMenuMobileActive: !this.layoutState().staticMenuMobileActive }));

            if (this.layoutState().staticMenuMobileActive) {
                this.overlayOpen.next(null);
            }
        }
    }

    isDesktop() {
        return window.innerWidth > 991;
    }

    isMobile() {
        return !this.isDesktop();
    }

    onConfigUpdate() {
        this._config = { ...this.layoutConfig() };
        this.configUpdate.next(this.layoutConfig());
    }

    private saveConfig(config: any) {
        for (let key of Object.keys(config)) {
            let preference = this.localStorageService.getItem(key);
            const value = config[key];
            const strValue: string = value == null ? '' : String(value);

            if (!preference) {
                preference = new Preferences();
                preference.key = key;
                preference.value = strValue;
                this.localStorageService.setItem(key, preference);

                // In modalità bootstrap e nelle pagine pubbliche la preferenza resta solo locale.
                this.tenantStatus.whenProvisioned().pipe(switchMap(() => this.preferencesService.count().pipe(first())), switchMap(count => {
                    const criteria = new PreferencesCriteria();
                    criteria.size = count;
                    criteria.page = 0;

                    return this.preferencesService.getAll(criteria).pipe(first());
                }), switchMap(result => {
                    if (!result.content.some(p => p.key === key)) {
                        return this.preferencesService.create(preference!);
                    }

                    return of(undefined);
                })).subscribe({
                    next: (result?: Preferences) => {
                        if (result) {
                            this.localStorageService.setItem(key, result);
                        }
                    }
                });
            } else if (preference.value !== strValue) {
                preference.value = strValue;
                this.localStorageService.setItem(key, preference);
                const current = preference;
                if (current.id) {
                    this.tenantStatus.whenProvisioned().pipe(switchMap(() => this.preferencesService.update(current.id!, current).pipe(first()))).subscribe(result => {
                        this.localStorageService.setItem(key, result);
                    });
                }
            }
        }
    }

    onMenuStateChange(event: MenuChangeEvent) {
        this.menuSource.next(event);
    }

    reset() {
        this.resetSource.next(true);
    }
}
