import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, QueryList, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, take, forkJoin } from 'rxjs';
import { SoundpadService } from './services/soundpad.service';
import { Sound, ConnectionStatus, Category, CategoryIcon } from './models/sound.model';
import { SoundCardComponent } from './components/sound-card/sound-card.component';
import { SearchBarComponent } from './components/search-bar/search-bar.component';
import { ConnectionStatusComponent } from './components/connection-status/connection-status.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    SoundCardComponent,
    SearchBarComponent,
    ConnectionStatusComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  sounds: Sound[] = [];
  filteredSounds: Sound[] = [];
  categories: Category[] = [];
  isConnected = false;
  isLoading = true;
  currentlyPlayingIndex: number | null = null;
  isActuallyPlaying = false;
  isPaused = false;
  volume = 100;
  playbackMode: 'both' | 'mic' | 'speakers' = 'both';
  searchQuery = '';
  isSettingsModalOpen = false;
  isRestarting = false;
  isRenameMode = false;
  isRenameModalOpen = false;
  isRenaming = false;
  soundToRename: Sound | null = null;
  renameValue = '';

  // Playback progress tracking
  playbackProgress = 0;
  playbackTimeRemaining = 0;
  currentSoundDuration = 0;
  playbackStartTime = 0;

  // Category icons mapping (SVG paths for fallback)
  categoryIcons: { [key: string]: string } = {
    'default': 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
  };

  // Category icons from soundlist.spl (base64 images)
  categoryIconsMap: Map<string, CategoryIcon> = new Map();
  // Ordered list of category names as they appear in Soundpad (from SPL file)
  categoryOrder: string[] = [];

  // Category visibility tracking for scroll reveal
  visibleCategories: Set<string> = new Set();
  private intersectionObserver: IntersectionObserver | null = null;

  // Active category for nav highlight
  activeCategory: string = '';

  @ViewChild('categoriesContainer') categoriesContainer!: ElementRef;
  @ViewChild('mainContent') mainContent!: ElementRef;
  @ViewChild('categoryNavList') categoryNavList!: ElementRef;
  @ViewChild('renameInput') renameInput!: ElementRef<HTMLInputElement>;
  @ViewChild('scrollEndSpacer') scrollEndSpacer!: ElementRef<HTMLElement>;

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private playbackTimer: any = null;
  private scrollListener: (() => void) | null = null;
  private snapWheelListener: ((e: WheelEvent) => void) | null = null;
  private snapScrollListener: (() => void) | null = null;
  private snapDebounceTimer: any = null;
  private snapScrollDebounceTimer: any = null;
  private isSnapping = false;
  private lastWheelDeltaY = 0;

  constructor(private soundpadService: SoundpadService) {}

  ngOnInit(): void {
    // Subscribe to connection status (no auto-refresh on connection change)
    this.soundpadService.getConnectionStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe((status: ConnectionStatus) => {
        this.isConnected = status.connected;
      });

    // Setup search with debounce
    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.filterSounds(query);
    });

    // Initial load only once
    this.loadSounds();

    // Reload sounds automatically whenever soundlist.spl changes on disk.
    // Use silent=true so the existing sound list stays visible while Soundpad
    // restarts after a rename (avoids the "No Sounds Found" flash).
    this.soundpadService.listenForConfigChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('[config-watch] soundlist.spl changed – reloading sounds');
        this.loadSounds(true);
      });
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
    this.setupScrollFade();
    this.setupScrollSnap();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    if (this.scrollListener && this.mainContent?.nativeElement) {
      this.mainContent.nativeElement.removeEventListener('scroll', this.scrollListener);
      this.scrollListener = null;
    }
    if (this.snapWheelListener && this.mainContent?.nativeElement) {
      this.mainContent.nativeElement.removeEventListener('wheel', this.snapWheelListener);
      this.snapWheelListener = null;
    }
    if (this.snapScrollListener && this.mainContent?.nativeElement) {
      this.mainContent.nativeElement.removeEventListener('scroll', this.snapScrollListener);
      this.snapScrollListener = null;
    }
    if (this.snapDebounceTimer) {
      clearTimeout(this.snapDebounceTimer);
      this.snapDebounceTimer = null;
    }
    if (this.snapScrollDebounceTimer) {
      clearTimeout(this.snapScrollDebounceTimer);
      this.snapScrollDebounceTimer = null;
    }
  }

  setupScrollFade(): void {
    const container = this.mainContent?.nativeElement;
    if (!container) return;

    this.scrollListener = () => {
      const containerRect = container.getBoundingClientRect();
      const fadeZone = 80; // px over which to fade per row

      // Collect all row-level elements: category dividers, sub-category dividers, and sound cards
      const rowElements = container.querySelectorAll(
        '.category-divider, .sub-category-divider, app-sound-card'
      ) as NodeListOf<HTMLElement>;

      // Group elements by their rounded top position (same row = same top)
      const rowGroups = new Map<number, HTMLElement[]>();
      rowElements.forEach((el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        // Round to nearest 4px to group cards on the same flex row
        const rowKey = Math.round(rect.top / 4) * 4;
        if (!rowGroups.has(rowKey)) {
          rowGroups.set(rowKey, []);
        }
        rowGroups.get(rowKey)!.push(el);
      });

      // Apply opacity per row group based on how much the row is clipped
      rowGroups.forEach((els) => {
        // Use the bounding rect of the first element in the group as representative
        const rect = els[0].getBoundingClientRect();
        const rowTop = rect.top;
        const rowBottom = rect.bottom;

        const topClip = containerRect.top - rowTop;   // positive = row is above viewport top
        const bottomClip = rowBottom - containerRect.bottom; // positive = row is below viewport bottom
        const clip = Math.max(topClip, bottomClip, 0);
        const opacity = clip === 0 ? 1 : Math.max(0, 1 - clip / fadeZone);

        els.forEach(el => {
          el.style.opacity = String(opacity);
        });
      });

      // Update active category for nav highlight
      this.updateActiveCategory(container, containerRect);
    };

    container.addEventListener('scroll', this.scrollListener, { passive: true });
    // Run once on init
    this.scrollListener();
  }

  /**
   * Collect all absolute scroll positions (in the container) that correspond to
   * the top of each row of sound cards.  A "row" is a group of app-sound-card
   * elements that share the same vertical offset inside the scroll container.
   */
  private getSnapPoints(container: HTMLElement): number[] {
    const cards = container.querySelectorAll('app-sound-card') as NodeListOf<HTMLElement>;
    if (!cards.length) return [];

    const containerTop = container.getBoundingClientRect().top;

    // The offset from the container top to the sidenav list top — this is the same
    // reference used by scrollToCategory() so snapping stays consistent with nav clicks.
    const navOffset = this.categoryNavList?.nativeElement
      ? this.categoryNavList.nativeElement.getBoundingClientRect().top - containerTop
      : 0;

    // Measure the height of the sticky category divider (offsetHeight = box height
    // including padding but not margin).  When a divider is sticking at top:0 it
    // covers this many pixels at the top of the viewport.
    let stickyDividerHeight = 0;
    const sampleDivider = container.querySelector('.category-divider') as HTMLElement | null;
    if (sampleDivider) {
      stickyDividerHeight = sampleDivider.offsetHeight;
    }

    // Collect the absolute top of every category section so we can tell whether a
    // given card row is the first row of its category (needs the navOffset alignment)
    // or a subsequent row (needs the stickyDividerHeight alignment).
    const categorySections = container.querySelectorAll('.category-section') as NodeListOf<HTMLElement>;
    // For each category section, compute the snap point that aligns its top with the
    // sidenav list top — identical to what scrollToCategory() produces.
    const categorySnapPoints: number[] = [];
    categorySections.forEach((section: HTMLElement) => {
      const sectionTop = section.getBoundingClientRect().top - containerTop + container.scrollTop;
      categorySnapPoints.push(Math.max(0, sectionTop - navOffset));
    });

    // Collect absolute tops of sub-category dividers so they also snap into view
    const subCategoryDividers = container.querySelectorAll('.sub-category-divider') as NodeListOf<HTMLElement>;
    const subCategorySnapPoints: number[] = [];
    subCategoryDividers.forEach((divider: HTMLElement) => {
      const dividerTop = divider.getBoundingClientRect().top - containerTop + container.scrollTop;
      // Align the sub-category header just below the sticky category divider
      const snapPoint = Math.max(0, dividerTop - navOffset - stickyDividerHeight);
      subCategorySnapPoints.push(snapPoint);
    });

    // Map from rounded row-bucket → absolute card top for that row
    const rowMap = new Map<number, number>();
    cards.forEach((card: HTMLElement) => {
      const cardTop = card.getBoundingClientRect().top - containerTop + container.scrollTop;
      const bucket = Math.round(cardTop / 4) * 4;
      if (!rowMap.has(bucket)) {
        rowMap.set(bucket, cardTop);
      }
    });

    const snapSet = new Set<number>();

    // Add category-level snap points (aligns category icon with sidenav list top)
    categorySnapPoints.forEach(p => snapSet.add(Math.round(p)));

    // Add sub-category divider snap points so scrolling snaps to sub-category headers too
    subCategorySnapPoints.forEach(p => {
      const rounded = Math.round(p);
      const coveredByCategory = categorySnapPoints.some(cp => Math.abs(cp - p) < 8);
      if (!coveredByCategory) {
        snapSet.add(rounded);
      }
    });

    // All snap points so far (categories + sub-categories) — used to de-duplicate card rows
    const allHeaderSnapPoints = [...categorySnapPoints, ...subCategorySnapPoints];

    // Add card-row snap points for rows that are NOT the first row of a category.
    // The sticky divider sticks at top:1.5rem (= navOffset) inside the scroll container,
    // so it occupies viewport from navOffset to navOffset+stickyDividerHeight.
    // We offset by (navOffset + stickyDividerHeight) so the row lands cleanly just
    // below the sticky header.
    const sortedCardTops = Array.from(rowMap.values()).sort((a, b) => a - b);
    sortedCardTops.forEach(cardTop => {
      const snapPoint = Math.max(0, cardTop - navOffset - stickyDividerHeight);
      // Only add if it's not already covered by a category or sub-category snap point
      const rounded = Math.round(snapPoint);
      const coveredByHeader = allHeaderSnapPoints.some(cp => Math.abs(cp - snapPoint) < 8);
      if (!coveredByHeader) {
        snapSet.add(rounded);
      }
    });

    return Array.from(snapSet).sort((a, b) => a - b);
  }

  setupScrollSnap(): void {
    const container = this.mainContent?.nativeElement;
    if (!container) return;

    this.snapWheelListener = (e: WheelEvent) => {
      // Don't interrupt a programmatic snap already in progress
      if (this.isSnapping) return;

      // Accumulate wheel direction so we know which way the user was scrolling
      this.lastWheelDeltaY += e.deltaY;

      // Debounce: wait until the user stops scrolling, then snap
      if (this.snapDebounceTimer) {
        clearTimeout(this.snapDebounceTimer);
      }

      this.snapDebounceTimer = setTimeout(() => {
        this.snapDebounceTimer = null;
        if (this.isSnapping) return;

        const snapPoints = this.getSnapPoints(container);
        if (!snapPoints.length) return;

        const currentScroll = container.scrollTop;
        const scrollingDown = this.lastWheelDeltaY >= 0;
        // Reset accumulated delta for the next gesture
        this.lastWheelDeltaY = 0;

        let target: number | null = null;

        if (scrollingDown) {
          // Find the nearest snap point that is >= currentScroll (snap forward / downward only)
          for (const point of snapPoints) {
            if (point >= currentScroll - 2) {
              target = point;
              break;
            }
          }
          // Fallback: last snap point
          if (target === null) target = snapPoints[snapPoints.length - 1];
        } else {
          // Scrolling up — find the nearest snap point that is <= currentScroll
          const reversed = [...snapPoints].reverse();
          for (const point of reversed) {
            if (point <= currentScroll + 2) {
              target = point;
              break;
            }
          }
          // Fallback: first snap point
          if (target === null) target = snapPoints[0];
        }

        // Only snap if we're not already there (avoid micro-jitter)
        if (Math.abs(currentScroll - target) > 2) {
          this.isSnapping = true;
          this.fastScrollTo(container, target, 200);
          // Release the snap lock after the animation completes
          setTimeout(() => { this.isSnapping = false; }, 250);
        }
      }, 80);
    };

    container.addEventListener('wheel', this.snapWheelListener, { passive: true });

    // Also snap when using the scrollbar (scroll events, not wheel events)
    this.snapScrollListener = () => {
      // Ignore scroll events fired by our own programmatic snapping
      if (this.isSnapping) return;

      if (this.snapScrollDebounceTimer) {
        clearTimeout(this.snapScrollDebounceTimer);
      }

      this.snapScrollDebounceTimer = setTimeout(() => {
        this.snapScrollDebounceTimer = null;
        if (this.isSnapping) return;

        const snapPoints = this.getSnapPoints(container);
        if (!snapPoints.length) return;

        const currentScroll = container.scrollTop;

        // Find the nearest snap point (no direction bias for scrollbar drags)
        let target = snapPoints[0];
        let minDist = Math.abs(currentScroll - snapPoints[0]);
        for (const point of snapPoints) {
          const dist = Math.abs(currentScroll - point);
          if (dist < minDist) {
            minDist = dist;
            target = point;
          }
        }

        if (Math.abs(currentScroll - target) > 2) {
          this.isSnapping = true;
          this.fastScrollTo(container, target, 200);
          setTimeout(() => { this.isSnapping = false; }, 250);
        }
      }, 150);
    };

    container.addEventListener('scroll', this.snapScrollListener, { passive: true });
  }

  updateActiveCategory(container: HTMLElement, containerRect: DOMRect): void {
    const categorySections = container.querySelectorAll('.category-section[data-category]') as NodeListOf<HTMLElement>;
    let current = '';
    categorySections.forEach((section: HTMLElement) => {
      const rect = section.getBoundingClientRect();
      // The category whose top edge is at or above the container's top is the "current" one
      if (rect.top <= containerRect.top + 80) {
        current = section.getAttribute('data-category') || '';
      }
    });
    if (current && current !== this.activeCategory) {
      this.activeCategory = current;
    } else if (!current && this.categories.length > 0 && !this.activeCategory) {
      this.activeCategory = this.categories[0].name;
    }
  }

  scrollToCategory(categoryName: string): void {
    const container = this.mainContent?.nativeElement;
    if (!container) return;
    const section = container.querySelector(`.category-section[data-category="${CSS.escape(categoryName)}"]`) as HTMLElement | null;
    if (section) {
      // Immediately highlight the clicked category in the sidenav
      this.activeCategory = categoryName;
      const containerRect = container.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();

      // Align the top of the category section with the top of the sidenav list
      // so the category icon lines up with the first nav item.
      const navListTop = this.categoryNavList?.nativeElement
        ? this.categoryNavList.nativeElement.getBoundingClientRect().top
        : containerRect.top;
      const offset = navListTop - containerRect.top;
      const targetScrollTop = container.scrollTop + (sectionRect.top - containerRect.top) - offset;
      this.fastScrollTo(container, targetScrollTop, 180);
    }
  }

  private fastScrollTo(element: HTMLElement, targetY: number, duration: number): void {
    const startY = element.scrollTop;
    const distance = targetY - startY;
    const startTime = performance.now();

    const step = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic for snappy feel
      const ease = 1 - Math.pow(1 - progress, 3);
      element.scrollTop = startY + distance * ease;
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }

  setupIntersectionObserver(): void {
    // Create intersection observer to detect when categories become fully visible
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const categoryName = entry.target.getAttribute('data-category');
          if (categoryName) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.9) {
              // Category is fully visible (90%+)
              this.visibleCategories.add(categoryName);
            }
          }
        });
      },
      {
        root: null, // viewport
        rootMargin: '0px',
        threshold: [0, 0.5, 0.9, 1.0] // Multiple thresholds for smoother detection
      }
    );
  }

  observeCategory(element: HTMLElement, categoryName: string): void {
    if (this.intersectionObserver && element) {
      element.setAttribute('data-category', categoryName);
      this.intersectionObserver.observe(element);
    }
  }

  isCategoryVisible(categoryName: string): boolean {
    return this.visibleCategories.has(categoryName);
  }

  loadSounds(silent = false): void {
    // When reloading silently (e.g. triggered by config-watch after a rename),
    // don't show the loading spinner so the existing sound list stays visible.
    if (!silent) {
      this.isLoading = true;
    }
    // Clear visible categories when reloading
    this.visibleCategories.clear();

    // Fetch both sounds and category icons in parallel
    forkJoin({
      sounds: this.soundpadService.getSounds().pipe(take(1)),
      categoryIcons: this.soundpadService.getCategoryIcons().pipe(take(1))
    }).subscribe({
      next: ({ sounds, categoryIcons }) => {
        // If Soundpad is still restarting it may return an empty list.
        // In that case keep the existing sounds visible so the UI doesn't
        // flash the "No Sounds Found" empty state.
        if (sounds.length === 0 && this.sounds.length > 0) {
          this.isLoading = false;
          return;
        }

        this.sounds = sounds;
        this.filteredSounds = sounds;

        // Build category icons map and preserve SPL order
        this.categoryIconsMap.clear();
        this.categoryOrder = categoryIcons.map(icon => icon.name);
        categoryIcons.forEach(icon => {
          this.categoryIconsMap.set(icon.name, icon);
        });

        // Re-apply any active search filter so results stay consistent;
        // filterSounds() also calls groupSoundsByCategory() internally.
        if (this.searchQuery.trim()) {
          this.filterSounds(this.searchQuery);
        } else {
          this.groupSoundsByCategory(this.filteredSounds);
        }
        this.isLoading = false;

        // Observe category elements after view updates
        setTimeout(() => {
          this.observeAllCategories();
          this.updateSpacerHeight();
          this.scrollListener?.();
          // Seed active category to the first one if not already set
          if (!this.activeCategory && this.categories.length > 0) {
            this.activeCategory = this.categories[0].name;
          }
        }, 0);
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  observeAllCategories(): void {
    if (!this.intersectionObserver) {
      this.setupIntersectionObserver();
    }

    // Disconnect existing observations
    this.intersectionObserver?.disconnect();

    // Find all category sections and observe them
    const categoryElements = document.querySelectorAll('.category-section[data-category]');
    categoryElements.forEach((element) => {
      this.intersectionObserver?.observe(element);
    });
  }

  /**
   * Set the scroll-end-spacer height so the last category section can scroll
   * exactly to the top of the viewport (aligned with the nav list) while the
   * scrollbar reaches its end.
   *
   * We use getBoundingClientRect so that margins, padding, and the nav offset
   * are all accounted for correctly.
   *
   * Desired invariant:
   *   maxScroll == lastSection.top_in_scroll_container - navOffset
   *
   * maxScroll = scrollHeight - clientHeight
   * scrollHeight (after setting spacer) = lastSectionBottom_in_scroll_container + spacerHeight
   *
   * Solving for spacerHeight:
   *   spacerHeight = clientHeight - navOffset - lastSection.offsetHeight
   *
   * where lastSection.offsetHeight is the rendered height of the last section
   * (excluding its bottom margin, which we add explicitly).
   */
  updateSpacerHeight(): void {
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    const spacer = this.scrollEndSpacer?.nativeElement as HTMLElement | undefined;
    if (!container || !spacer) return;

    // Temporarily zero out the spacer so measurements are clean
    spacer.style.height = '0px';

    const categorySections = container.querySelectorAll('.category-section') as NodeListOf<HTMLElement>;
    if (!categorySections.length) {
      return;
    }

    const containerRect = container.getBoundingClientRect();

    // navOffset: distance from container top to where category tops should align
    const navOffset = this.categoryNavList?.nativeElement
      ? this.categoryNavList.nativeElement.getBoundingClientRect().top - containerRect.top
      : 0;

    const lastSection = categorySections[categorySections.length - 1];
    const lastSectionRect = lastSection.getBoundingClientRect();

    // Absolute position of the last section's top within the scroll container
    const lastSectionTop = lastSectionRect.top - containerRect.top + container.scrollTop;

    // Spacer height needed so that maxScroll == lastSectionTop - navOffset
    // maxScroll = (lastSectionTop + lastSection.offsetHeight + spacerHeight) - clientHeight
    // Setting maxScroll = lastSectionTop - navOffset:
    //   spacerHeight = clientHeight - navOffset - lastSection.offsetHeight
    const spacerHeight = Math.max(0, container.clientHeight - navOffset - lastSection.offsetHeight);
    spacer.style.height = `${spacerHeight}px`;
  }

  onSearch(query: string): void {
    this.searchQuery = query;
    this.searchSubject$.next(query);
  }

  filterSounds(query: string): void {
    if (!query.trim()) {
      this.filteredSounds = this.sounds;
      this.groupSoundsByCategory(this.sounds);
      return;
    }

    const lowerQuery = query.toLowerCase();
    this.filteredSounds = this.sounds.filter(sound =>
      sound.title.toLowerCase().includes(lowerQuery) ||
      sound.artist.toLowerCase().includes(lowerQuery) ||
      sound.category.toLowerCase().includes(lowerQuery)
    );
    this.groupSoundsByCategory(this.filteredSounds);
  }

  resolveCategoryImageUrl(categoryIcon: CategoryIcon | undefined): string {
    if (!categoryIcon || !categoryIcon.icon) return '';
    if (categoryIcon.isBase64) {
      return `data:image/png;base64,${categoryIcon.icon}`;
    }
    // File path icon — serve via the proxy endpoint
    if (!categoryIcon.icon.startsWith('stock_')) {
      return `http://localhost:3000/api/category-image?path=${encodeURIComponent(categoryIcon.icon)}`;
    }
    return '';
  }

  groupSoundsByCategory(sounds: Sound[]): void {
    // Build a map of top-level categories (parentCategory === '')
    // and sub-categories (parentCategory !== '')
    const topLevelMap = new Map<string, { sounds: Sound[], image: string, subCategories: Map<string, { sounds: Sound[], image: string }> }>();

    sounds.forEach(sound => {
      const category = sound.category || 'Uncategorized';
      const parentCategory = sound.parentCategory || '';

      if (parentCategory) {
        // This sound belongs to a sub-category
        // Ensure the parent category exists
        if (!topLevelMap.has(parentCategory)) {
          const parentIcon = this.categoryIconsMap.get(parentCategory);
          const parentImage = this.resolveCategoryImageUrl(parentIcon);
          topLevelMap.set(parentCategory, { sounds: [], image: parentImage, subCategories: new Map() });
        }

        const parentEntry = topLevelMap.get(parentCategory)!;

        // Ensure the sub-category exists under the parent
        if (!parentEntry.subCategories.has(category)) {
          const subIcon = this.categoryIconsMap.get(category);
          const subImage = this.resolveCategoryImageUrl(subIcon);
          parentEntry.subCategories.set(category, { sounds: [], image: subImage });
        }

        parentEntry.subCategories.get(category)!.sounds.push(sound);
      } else {
        // This sound belongs to a top-level category
        if (!topLevelMap.has(category)) {
          const categoryIcon = this.categoryIconsMap.get(category);
          const image = this.resolveCategoryImageUrl(categoryIcon);
          topLevelMap.set(category, { sounds: [], image, subCategories: new Map() });
        }
        topLevelMap.get(category)!.sounds.push(sound);
      }
    });

    // Sort entries by Soundpad's original category order from the SPL file,
    // falling back to insertion order for any category not in the list,
    // and always putting 'Uncategorized' at the end.
    const splOrderedEntries = <T>(map: Map<string, T>): Array<[string, T]> => {
      const entries = Array.from(map.entries());
      return entries.sort((a, b) => {
        if (a[0] === 'Uncategorized') return 1;
        if (b[0] === 'Uncategorized') return -1;
        const aIdx = this.categoryOrder.indexOf(a[0]);
        const bIdx = this.categoryOrder.indexOf(b[0]);
        // Both known: sort by SPL position
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        // Only one known: known comes first
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        // Neither known: preserve insertion order (stable sort)
        return 0;
      });
    };

    // Convert map to array in Soundpad's order, with 'Uncategorized' at the end.
    // Sort sounds within each category/sub-category by their categoryIndex to preserve
    // the exact order as they appear in Soundpad (derived from the SPL file).
    this.categories = splOrderedEntries(topLevelMap).map(([name, data]) => ({
      name,
      sounds: data.sounds.slice().sort((a, b) => a.categoryIndex - b.categoryIndex),
      image: data.image,
      subCategories: splOrderedEntries(data.subCategories).map(([subName, subData]) => ({
        name: subName,
        sounds: subData.sounds.slice().sort((a, b) => a.categoryIndex - b.categoryIndex),
        image: subData.image,
        subCategories: []
      }))
    }));
  }

  getCategoryIcon(categoryName: string): string {
    return this.categoryIcons[categoryName.toLowerCase()] || this.categoryIcons['default'];
  }

  getCategoryImageUrl(categoryName: string): string | null {
    const categoryIcon = this.categoryIconsMap.get(categoryName);
    if (categoryIcon && categoryIcon.isBase64) {
      return `data:image/png;base64,${categoryIcon.icon}`;
    }
    return null;
  }

  encodeURIComponent(str: string): string {
    return encodeURIComponent(str);
  }

  trackByCategory(index: number, category: Category): string {
    return category.name;
  }

  getTotalSoundCount(category: Category): number {
    const subTotal = category.subCategories.reduce((sum, sub) => sum + sub.sounds.length, 0);
    return category.sounds.length + subTotal;
  }

  playSound(sound: Sound): void {
    this.soundpadService.playSound(sound.index, this.playbackMode === 'speakers', this.playbackMode === 'mic')
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.currentlyPlayingIndex = sound.index;
          this.isActuallyPlaying = true;
          this.isPaused = false;

          // Parse duration and start progress tracking
          this.currentSoundDuration = this.parseDuration(sound.duration);
          this.playbackStartTime = Date.now();
          this.playbackProgress = 0;
          this.playbackTimeRemaining = this.currentSoundDuration;

          this.startProgressTimer();
        },
        error: (err) => {
          console.error('Failed to play sound:', err);
        }
      });
  }

  parseDuration(duration: string): number {
    if (!duration) return 0;
    const parts = duration.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return parseInt(duration, 10) || 0;
  }

  startProgressTimer(): void {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }

    this.playbackTimer = setInterval(() => {
      if (this.currentlyPlayingIndex !== null && !this.isPaused && this.currentSoundDuration > 0) {
        const elapsed = (Date.now() - this.playbackStartTime) / 1000;
        this.playbackProgress = Math.min((elapsed / this.currentSoundDuration) * 100, 100);
        this.playbackTimeRemaining = Math.max(this.currentSoundDuration - elapsed, 0);

        if (this.playbackTimeRemaining <= 0) {
          // Sound finished - reset everything
          this.currentlyPlayingIndex = null;
          this.isActuallyPlaying = false;
          this.playbackProgress = 0;
          this.playbackTimeRemaining = 0;
          clearInterval(this.playbackTimer);
          this.playbackTimer = null;
        }
      }
    }, 100);
  }

  stopSound(): void {
    this.soundpadService.stopSound()
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.currentlyPlayingIndex = null;
          this.isActuallyPlaying = false;
          this.isPaused = false;
          this.playbackProgress = 0;
          this.playbackTimeRemaining = 0;
          if (this.playbackTimer) {
            clearInterval(this.playbackTimer);
            this.playbackTimer = null;
          }
        },
        error: (err) => {
          console.error('Failed to stop sound:', err);
        }
      });
  }

  togglePause(): void {
    this.soundpadService.togglePause()
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isPaused = !this.isPaused;
          if (!this.isPaused) {
            // Resuming - adjust start time
            this.playbackStartTime = Date.now() - (this.currentSoundDuration - this.playbackTimeRemaining) * 1000;
          }
        },
        error: (err) => {
          console.error('Failed to toggle pause:', err);
        }
      });
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.soundpadService.setVolume(volume)
      .pipe(take(1))
      .subscribe({
        error: (err) => {
          console.error('Failed to set volume:', err);
        }
      });
  }

  setPlaybackMode(mode: 'both' | 'mic' | 'speakers'): void {
    this.playbackMode = mode;
  }

  refreshSounds(): void {
    this.loadSounds();
  }

  trackByIndex(index: number, sound: Sound): number {
    return sound.index;
  }

  toggleSettingsModal(): void {
    this.isSettingsModalOpen = !this.isSettingsModalOpen;
  }

  toggleRenameMode(): void {
    this.isRenameMode = !this.isRenameMode;
    // Close rename modal if exiting rename mode
    if (!this.isRenameMode) {
      this.isRenameModalOpen = false;
      this.soundToRename = null;
      this.renameValue = '';
    }
  }

  openRenameModal(sound: Sound): void {
    this.soundToRename = sound;
    this.renameValue = sound.title;
    this.isRenameModalOpen = true;
    // Focus the input after the modal renders
    setTimeout(() => {
      this.renameInput?.nativeElement?.focus();
      this.renameInput?.nativeElement?.select();
    }, 50);
  }

  cancelRename(): void {
    this.isRenameModalOpen = false;
    this.soundToRename = null;
    this.renameValue = '';
  }

  confirmRename(): void {
    if (!this.soundToRename || !this.renameValue.trim() || this.isRenaming) return;

    this.isRenaming = true;
    const sound = this.soundToRename;
    const newTitle = this.renameValue.trim();

    // Rename the tag in soundlist.spl and forcefully restart Soundpad to apply the change
    this.soundpadService.restartSoundpad(sound.index, newTitle)
      .pipe(take(1))
      .subscribe({
        next: () => {
          // Update the sound title locally so the UI reflects the change immediately
          sound.title = newTitle;
          this.isRenaming = false;
          this.isRenameModalOpen = false;
          this.soundToRename = null;
          this.renameValue = '';
          // Exit rename mode after a successful rename
          this.isRenameMode = false;
        },
        error: (err) => {
          console.error('Failed to rename sound:', err);
          this.isRenaming = false;
        }
      });
  }

  restartSoundpad(): void {
    if (this.isRestarting) return;

    this.isRestarting = true;
    this.soundpadService.restartSoundpad()
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          console.log('Restart command sent:', response);
          // Briefly show a message or just close the modal
          setTimeout(() => {
            this.isRestarting = false;
            this.isSettingsModalOpen = false;
          }, 2000);
        },
        error: (err) => {
          console.error('Failed to restart Soundpad:', err);
          this.isRestarting = false;
        }
      });
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
