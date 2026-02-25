import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  SimpleChanges,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDragStart, CdkDropList, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Category, Sound } from '../../models/sound.model';
import { SoundCardComponent } from '../sound-card/sound-card.component';

@Component({
  selector: 'app-content',
  standalone: true,
  imports: [CommonModule, SoundCardComponent, DragDropModule],
  templateUrl: './content.component.html',
  styleUrls: ['./content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContentComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input() categories: Category[] = [];
  @Input() filteredSounds: Sound[] = [];
  @Input() isLoading = false;
  @Input() searchQuery = '';
  @Input() currentlyPlayingIndex: number | null = null;
  @Input() isRenameMode = false;
  @Input() isReorderMode = false;
  @Input() activeCategory = '';
  @Output() playSound = new EventEmitter<Sound>();
  @Output() openRenameModal = new EventEmitter<Sound>();
  @Output() activeCategoryChange = new EventEmitter<string>();
  @Output() reorderSound = new EventEmitter<{ soundIndex: number; targetCategory: string; targetPosition: number }>();
  @Output() reorderCategory = new EventEmitter<{ categoryName: string; targetPosition: number }>();
  @Output() dragStateChange = new EventEmitter<boolean>();
  @Output() soundContextMenu = new EventEmitter<{ sound: Sound; event: MouseEvent }>();

  @ViewChild('mainContent') mainContent!: ElementRef;
  @ViewChild('categoryNavList') categoryNavList!: ElementRef;
  @ViewChild('scrollEndSpacer') scrollEndSpacer!: ElementRef<HTMLElement>;

  isDragging = false;

  // Category reorder drag state
  categoryDraggingIdx = -1;
  categoryDragOverIdx = -1;
  private categoryDragHandle: HTMLElement | null = null;
  private categoryPointerMoveListener: ((e: PointerEvent) => void) | null = null;
  private categoryPointerUpListener: ((e: PointerEvent) => void) | null = null;

  /** Tracks image URLs that failed to load so they aren't retried on re-render */
  failedImageUrls = new Set<string>();

  private scrollListener: (() => void) | null = null;
  private snapWheelListener: ((e: WheelEvent) => void) | null = null;
  private snapScrollListener: (() => void) | null = null;
  private snapDebounceTimer: any = null;
  private snapScrollDebounceTimer: any = null;
  private isSnapping = false;
  private lastWheelDeltaY = 0;
  private dragSettleTimer: any = null;

  /** Listeners added outside Angular zone for drag performance */
  private dragOverListener: ((e: DragEvent) => void) | null = null;
  private dragEnterListener: ((e: DragEvent) => void) | null = null;
  private dragLeaveListener: ((e: DragEvent) => void) | null = null;

  /** Pointer position tracked during drag for center-based sort predicate */
  private dragPointerX = 0;
  private dragPointerY = 0;
  private pointerMoveListener: ((e: PointerEvent) => void) | null = null;
  /** Accumulated horizontal drag direction: 1 = right, -1 = left, 0 = initial */
  private dragDirectionX = 0;

  /** FLIP animation: MutationObserver watching reorder grids during drag */
  private flipObservers: MutationObserver[] = [];
  /** FLIP animation: cached natural positions keyed by element */
  private flipPositionCache = new Map<HTMLElement, { left: number; top: number }>();
  /** FLIP animation duration in ms */
  private readonly FLIP_DURATION = 200;
  /** FLIP animation: pending rAF id for the invert phase */
  private flipRafId: number | null = null;
  /** FLIP animation: pending rAF id for the play phase (second frame) */
  private flipPlayRafId: number | null = null;

  constructor(
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngAfterViewInit(): void {
    this.setupScrollFade();
    this.setupScrollSnap();
    if (this.isReorderMode) {
      this.setupDragListenersOutsideZone();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['categories'] || changes['filteredSounds']) {
      // Clear previously-failed image URLs from newly received categories
      this.stripFailedImages();
      setTimeout(() => {
        this.updateSpacerHeight();
        this.scrollListener?.();
        if (!this.activeCategory && this.categories.length > 0) {
          this.activeCategoryChange.emit(this.categories[0].name);
        }
      }, 0);
    }
    // Set up or tear down native drag listeners when reorder mode changes
    if (changes['isReorderMode']) {
      if (this.isReorderMode) {
        this.setupDragListenersOutsideZone();
      } else {
        this.teardownDragListeners();
        this.cancelCategoryDrag();
      }
    }
  }

  ngOnDestroy(): void {
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
    if (this.dragSettleTimer) {
      clearTimeout(this.dragSettleTimer);
      this.dragSettleTimer = null;
    }
    this.teardownDragListeners();
    this.teardownFlipObservers();
    this.stopPointerTracking();
    this.cancelCategoryDrag();
  }

  /**
   * Register native dragover / dragenter / dragleave listeners outside
   * Angular's zone so that the frequent pointer-tracking events do NOT
   * trigger change detection on every frame.
   */
  private setupDragListenersOutsideZone(): void {
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    // Avoid double-binding
    this.teardownDragListeners();

    this.ngZone.runOutsideAngular(() => {
      this.dragOverListener = (e: DragEvent) => {
        e.preventDefault(); // required to allow drop
      };

      this.dragEnterListener = (e: DragEvent) => {
        e.preventDefault();
        const target = (e.target as HTMLElement).closest('.reorder-grid');
        if (target) {
          target.classList.add('drag-over');
        }
      };

      this.dragLeaveListener = (e: DragEvent) => {
        const target = (e.target as HTMLElement).closest('.reorder-grid');
        if (target) {
          target.classList.remove('drag-over');
        }
      };

      container.addEventListener('dragover', this.dragOverListener, { passive: false });
      container.addEventListener('dragenter', this.dragEnterListener, { passive: false });
      container.addEventListener('dragleave', this.dragLeaveListener, { passive: true });
    });
  }

  /** Remove native drag listeners when leaving reorder mode or on destroy. */
  private teardownDragListeners(): void {
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    if (this.dragOverListener) {
      container.removeEventListener('dragover', this.dragOverListener);
      this.dragOverListener = null;
    }
    if (this.dragEnterListener) {
      container.removeEventListener('dragenter', this.dragEnterListener);
      this.dragEnterListener = null;
    }
    if (this.dragLeaveListener) {
      container.removeEventListener('dragleave', this.dragLeaveListener);
      this.dragLeaveListener = null;
    }
  }

  onImageError(category: Category): void {
    if (category.image) {
      this.failedImageUrls.add(category.image);
    }
    category.image = '';
    this.cdr.markForCheck();
  }

  /** Returns true if the category has a valid (non-failed) image to display */
  hasValidImage(category: Category): boolean {
    return !!category.image && !this.failedImageUrls.has(category.image);
  }

  /** Proactively clear image URLs that previously failed so the <img> tag is never rendered for them */
  private stripFailedImages(): void {
    if (this.failedImageUrls.size === 0) return;
    for (const category of this.categories) {
      if (category.image && this.failedImageUrls.has(category.image)) {
        category.image = '';
      }
      for (const sub of category.subCategories) {
        if (sub.image && this.failedImageUrls.has(sub.image)) {
          sub.image = '';
        }
      }
    }
  }

  onDragStarted(_event: CdkDragStart): void {
    this.isDragging = true;
    this.dragStateChange.emit(true);
    this.setupFlipObservers();
    this.startPointerTracking();
    this.cdr.markForCheck();
  }

  onCategoryHandlePointerDown(event: PointerEvent, index: number): void {
    if (!this.isReorderMode) return;
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    this.categoryDraggingIdx = index;
    this.categoryDragOverIdx = index;
    this.categoryDragHandle = handle;
    this.cdr.markForCheck();

    this.categoryPointerMoveListener = (e: PointerEvent) => this.onCategoryPointerMove(e);
    this.categoryPointerUpListener = () => this.onCategoryPointerUp();

    this.ngZone.runOutsideAngular(() => {
      handle.addEventListener('pointermove', this.categoryPointerMoveListener!);
      handle.addEventListener('pointerup', this.categoryPointerUpListener!);
      handle.addEventListener('pointercancel', this.categoryPointerUpListener!);
    });
  }

  private onCategoryPointerMove(event: PointerEvent): void {
    const navList = this.categoryNavList?.nativeElement as HTMLElement | null;
    if (!navList) return;

    const el = document.elementFromPoint(event.clientX, event.clientY);
    const navItem = el?.closest('.category-nav-item') as HTMLElement | null;
    if (!navItem) return;

    const items = Array.from(navList.querySelectorAll('.category-nav-item')) as HTMLElement[];
    const idx = items.indexOf(navItem);
    if (idx !== -1 && idx !== this.categoryDragOverIdx) {
      this.categoryDragOverIdx = idx;
      this.ngZone.run(() => this.cdr.markForCheck());
    }
  }

  private onCategoryPointerUp(): void {
    const from = this.categoryDraggingIdx;
    const to = this.categoryDragOverIdx;

    this.cancelCategoryDrag();

    if (from !== -1 && to !== -1 && from !== to) {
      const [moved] = this.categories.splice(from, 1);
      this.categories.splice(to, 0, moved);
      this.ngZone.run(() => {
        this.reorderCategory.emit({ categoryName: moved.name, targetPosition: to });
        this.cdr.markForCheck();
      });
    }
  }

  private cancelCategoryDrag(): void {
    if (this.categoryDragHandle) {
      if (this.categoryPointerMoveListener) {
        this.categoryDragHandle.removeEventListener('pointermove', this.categoryPointerMoveListener);
        this.categoryPointerMoveListener = null;
      }
      if (this.categoryPointerUpListener) {
        this.categoryDragHandle.removeEventListener('pointerup', this.categoryPointerUpListener);
        this.categoryDragHandle.removeEventListener('pointercancel', this.categoryPointerUpListener);
        this.categoryPointerUpListener = null;
      }
      this.categoryDragHandle = null;
    }
    this.ngZone.run(() => {
      this.categoryDraggingIdx = -1;
      this.categoryDragOverIdx = -1;
      this.cdr.markForCheck();
    });
  }

  onNavDrop(event: CdkDragDrop<{ category: string; sounds: Sound[] }>): void {
    this.ngZone.run(() => {
      const sound: Sound = event.item.data;
      const targetCategoryName = event.container.data.category;
      const targetSounds = event.container.data.sounds;

      // Nothing to do if already at position 0 in the same top-level category
      if (event.previousContainer.data.category === targetCategoryName && event.previousIndex === 0) {
        this.endDrag();
        return;
      }

      // Suppress the CDK "fly to nav item" animation
      (event.item.element.nativeElement as HTMLElement).classList.add('nav-drop-instant');

      // Remove from previous container
      event.previousContainer.data.sounds.splice(event.previousIndex, 1);

      // Insert at position 0 in the target category
      targetSounds.unshift(sound);

      this.reorderSound.emit({
        soundIndex: sound.index,
        targetCategory: targetCategoryName,
        targetPosition: 0
      });

      this.scheduleDragEnd();
      this.cdr.markForCheck();
    });
  }

  onDrop(event: CdkDragDrop<{ category: string; sounds: Sound[] }>): void {
    // Re-enter Angular zone to ensure model updates trigger change detection
    this.ngZone.run(() => {
      const sound: Sound = event.item.data;

      if (event.previousContainer === event.container) {
        // Reorder within the same category
        if (event.previousIndex === event.currentIndex) {
          this.endDrag();
          return;
        }
        moveItemInArray(event.container.data.sounds, event.previousIndex, event.currentIndex);
      } else {
        // Move to a different category
        transferArrayItem(
          event.previousContainer.data.sounds,
          event.container.data.sounds,
          event.previousIndex,
          event.currentIndex
        );
      }

      // Emit the reorder event to persist the change
      const targetCategory = event.container.data.category;
      const targetPosition = event.currentIndex;
      this.reorderSound.emit({
        soundIndex: sound.index,
        targetCategory,
        targetPosition
      });

      // Allow the CDK drop animation to finish before signaling drag end
      this.scheduleDragEnd();
      this.cdr.markForCheck();
    });
  }

  /** Signal drag end after the CDK animation settles (300ms). */
  private scheduleDragEnd(): void {
    if (this.dragSettleTimer) {
      clearTimeout(this.dragSettleTimer);
    }
    this.dragSettleTimer = setTimeout(() => {
      this.dragSettleTimer = null;
      this.endDrag();
    }, 350);
  }

  private endDrag(): void {
    this.teardownFlipObservers();
    this.stopPointerTracking();
    this.isDragging = false;
    this.dragStateChange.emit(false);
    this.cdr.markForCheck();
  }

  // ── Pointer tracking & center-based sort predicate ──

  /**
   * Start tracking the pointer position globally during a drag operation.
   * Runs outside Angular zone to avoid triggering change detection on every
   * pointer move event.
   *
   * Also detects horizontal direction changes and immediately cancels any
   * in-progress FLIP CSS transitions when the user reverses direction.
   * This ensures CDK's elementFromPoint() finds items at their natural
   * layout positions, enabling correct bidirectional sorting.
   */
  private startPointerTracking(): void {
    this.stopPointerTracking();
    this.dragDirectionX = 0;
    this.ngZone.runOutsideAngular(() => {
      this.pointerMoveListener = (e: PointerEvent) => {
        const prevX = this.dragPointerX;
        this.dragPointerX = e.clientX;
        this.dragPointerY = e.clientY;

        // Detect horizontal direction change
        const dx = e.clientX - prevX;
        if (Math.abs(dx) > 1) { // ignore sub-pixel jitter
          const newDir = dx > 0 ? 1 : -1;
          if (this.dragDirectionX !== 0 && newDir !== this.dragDirectionX) {
            // Direction reversed — cancel FLIP transitions so
            // elementFromPoint() sees items at their natural positions
            this.cancelFlipTransitions();
          }
          this.dragDirectionX = newDir;
        }
      };
      document.addEventListener('pointermove', this.pointerMoveListener, { passive: true });
    });
  }

  /** Stop tracking the pointer position. */
  private stopPointerTracking(): void {
    if (this.pointerMoveListener) {
      document.removeEventListener('pointermove', this.pointerMoveListener);
      this.pointerMoveListener = null;
    }
    this.dragDirectionX = 0;
  }

  /**
   * Sort predicate for cdkDropList. Always returns true to allow CDK's
   * MixedSortStrategy to handle sorting in any direction. The FLIP
   * animation coalescing in scheduleFlip() handles jitter prevention
   * by batching rapid CDK placeholder mutations into a single smooth
   * animation per frame.
   *
   * Bound as an arrow function so it can be used directly in the template
   * via [cdkDropListSortPredicate]="sortPredicate".
   */
  sortPredicate = (_index: number, _drag: CdkDrag, _drop: CdkDropList): boolean => {
    return true;
  };

  // ── FLIP animation helpers for smooth sliding during drag ──

  /**
   * Capture the bounding rect of every .drag-card-wrapper inside all
   * .reorder-grid containers so we can FLIP-animate after the CDK
   * moves the placeholder (which causes an instant reflow in mixed mode).
   *
   * Stores the *natural* position (i.e. with any current transform backed out)
   * so that subsequent FLIP calculations are always relative to the true
   * layout position.
   */
  private snapshotGridPositions(): void {
    this.flipPositionCache.clear();
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    const wrappers = container.querySelectorAll(
      '.reorder-grid > .drag-card-wrapper:not(.cdk-drag-preview)'
    ) as NodeListOf<HTMLElement>;

    wrappers.forEach(el => {
      // getBoundingClientRect includes transforms, so back out any active
      // FLIP transform to get the natural layout position.
      const rect = el.getBoundingClientRect();
      // Skip hidden elements (e.g. the original element being dragged)
      if (rect.width === 0 && rect.height === 0) return;

      const tx = this.getTranslateValues(el);
      this.flipPositionCache.set(el, {
        left: rect.left - tx.x,
        top: rect.top - tx.y
      });
    });
  }

  /**
   * Extract the current translateX/Y from an element's computed transform.
   * Uses getComputedStyle to get the actual animated value during CSS
   * transitions, not just the target value from the inline style.
   */
  private getTranslateValues(el: HTMLElement): { x: number; y: number } {
    const computed = getComputedStyle(el).transform;
    if (!computed || computed === 'none') return { x: 0, y: 0 };
    // matrix(a, b, c, d, tx, ty) or matrix3d(...)
    const match = computed.match(/matrix(?:3d)?\(([^)]+)\)/);
    if (match) {
      const values = match[1].split(',').map(v => parseFloat(v.trim()));
      if (values.length === 6) {
        // 2D matrix: tx = values[4], ty = values[5]
        return { x: values[4], y: values[5] };
      } else if (values.length === 16) {
        // 3D matrix: tx = values[12], ty = values[13]
        return { x: values[12], y: values[13] };
      }
    }
    return { x: 0, y: 0 };
  }

  /**
   * After the DOM has reflowed (placeholder moved), compare each wrapper's
   * new natural position to its cached position and immediately apply an
   * invert transform so items visually stay at their old positions.
   *
   * This is the "First + Last + Invert" part of FLIP. The "Play" part
   * is handled by scheduleFlip() in the next animation frame.
   *
   * Key design: we compute the natural position by subtracting the current
   * computed transform from getBoundingClientRect, so we never need to
   * clear transforms or force reflow.
   */
  private applyFlipInvert(): void {
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    const wrappers = container.querySelectorAll(
      '.reorder-grid > .drag-card-wrapper:not(.cdk-drag-preview)'
    ) as NodeListOf<HTMLElement>;

    const newPositions = new Map<HTMLElement, { left: number; top: number }>();

    wrappers.forEach(el => {
      const rect = el.getBoundingClientRect();
      // Skip hidden elements (e.g. the original element being dragged, which CDK hides)
      if (rect.width === 0 && rect.height === 0) return;

      const tx = this.getTranslateValues(el);
      // Natural position = visual position minus current transform
      const naturalLeft = rect.left - tx.x;
      const naturalTop = rect.top - tx.y;
      newPositions.set(el, { left: naturalLeft, top: naturalTop });

      const first = this.flipPositionCache.get(el);
      if (!first) return; // new element, nothing to animate from

      const dx = first.left - naturalLeft;
      const dy = first.top - naturalTop;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        // Immediately jump to old visual position (invert) — no transition
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      }
    });

    // Update the cache with the new natural positions for the next mutation
    this.flipPositionCache = newPositions;
  }

  /**
   * Coalesce rapid CDK placeholder mutations into a single FLIP animation
   * cycle per frame. Instead of applying the invert transform synchronously
   * on every MutationObserver callback (which causes visible jitter when
   * CDK rapidly swaps the placeholder back and forth at item boundaries),
   * we defer both the invert and play phases to requestAnimationFrame.
   *
   * If multiple mutations fire within the same frame, only the last DOM
   * state is animated — eliminating the flickering.
   *
   * Before scheduling, we immediately cancel any in-progress FLIP CSS
   * transitions so items snap to their natural layout positions. This is
   * critical for bidirectional dragging: CDK uses elementFromPoint() to
   * detect swap targets, and mid-transition transforms would cause it to
   * miss items at their natural positions when the drag direction reverses.
   *
   * Frame 1 (rAF): snapshot → invert (items visually stay at old positions)
   * Frame 2 (rAF): play (transition items to their natural new positions)
   */
  private scheduleFlip(): void {
    // Immediately cancel any in-progress CSS transitions so items snap to
    // their natural layout positions. This ensures CDK's elementFromPoint()
    // finds items where they actually are, enabling bidirectional sorting.
    this.cancelFlipTransitions();

    // If an invert rAF is already pending, the upcoming frame will
    // capture the latest DOM state — no need to schedule another.
    if (this.flipRafId !== null) return;

    // Cancel any pending play-phase rAF from a previous cycle so we
    // don't animate to an outdated position.
    if (this.flipPlayRafId !== null) {
      cancelAnimationFrame(this.flipPlayRafId);
      this.flipPlayRafId = null;
    }

    this.flipRafId = requestAnimationFrame(() => {
      this.flipRafId = null;

      // Invert: compute deltas and apply instant transforms
      this.applyFlipInvert();

      // Play: in the next frame, transition to natural positions
      this.flipPlayRafId = requestAnimationFrame(() => {
        this.flipPlayRafId = null;

        const container = this.mainContent?.nativeElement as HTMLElement | undefined;
        if (!container) return;

        const wrappers = container.querySelectorAll(
          '.reorder-grid > .drag-card-wrapper:not(.cdk-drag-preview)'
        ) as NodeListOf<HTMLElement>;

        wrappers.forEach(el => {
          if (el.style.transform && el.style.transform !== 'translate(0px, 0px)') {
            el.style.transition = `transform ${this.FLIP_DURATION}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
            el.style.transform = 'translate(0px, 0px)';
          }
        });
      });
    });
  }

  /**
   * Immediately cancel any in-progress FLIP CSS transitions on all
   * drag-card-wrappers, snapping them to their natural layout positions.
   *
   * Called in two scenarios:
   * 1. Before scheduling a new FLIP cycle (from MutationObserver) so the
   *    snapshot captures clean natural positions.
   * 2. On drag direction change (from pointer move handler) so CDK's
   *    elementFromPoint() sees items at their true positions.
   *
   * Also refreshes the FLIP position cache so the next FLIP cycle
   * computes correct deltas from the current natural positions.
   */
  private cancelFlipTransitions(): void {
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    const wrappers = container.querySelectorAll(
      '.reorder-grid > .drag-card-wrapper:not(.cdk-drag-preview)'
    ) as NodeListOf<HTMLElement>;

    let hadTransforms = false;
    wrappers.forEach(el => {
      if (el.style.transform || el.style.transition) {
        el.style.transition = 'none';
        el.style.transform = '';
        hadTransforms = true;
      }
    });

    // Refresh the position cache so the next FLIP cycle has a correct
    // baseline. Only needed if we actually cleared transforms.
    if (hadTransforms) {
      this.snapshotGridPositions();
    }
  }

  /**
   * Set up MutationObservers on every .reorder-grid so that when the CDK
   * moves the placeholder (childList mutation), we FLIP-animate siblings.
   * Runs outside Angular zone for performance.
   *
   * On each mutation we schedule a coalesced FLIP cycle via rAF so that
   * rapid CDK sort swaps (jitter at item boundaries) are batched into a
   * single smooth animation per frame.
   */
  private setupFlipObservers(): void {
    this.teardownFlipObservers();

    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    // Take an initial snapshot so the first mutation has a baseline
    this.snapshotGridPositions();

    this.ngZone.runOutsideAngular(() => {
      const grids = container.querySelectorAll('.reorder-grid') as NodeListOf<HTMLElement>;

      grids.forEach(grid => {
        const observer = new MutationObserver(() => {
          // Coalesce rapid mutations into a single FLIP cycle per frame
          this.scheduleFlip();
        });

        observer.observe(grid, { childList: true });
        this.flipObservers.push(observer);
      });
    });
  }

  /** Disconnect all FLIP MutationObservers and clear the position cache. */
  private teardownFlipObservers(): void {
    for (const obs of this.flipObservers) {
      obs.disconnect();
    }
    this.flipObservers = [];

    if (this.flipRafId !== null) {
      cancelAnimationFrame(this.flipRafId);
      this.flipRafId = null;
    }

    if (this.flipPlayRafId !== null) {
      cancelAnimationFrame(this.flipPlayRafId);
      this.flipPlayRafId = null;
    }

    // Clean up any inline FLIP styles left on wrappers
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    if (container) {
      const wrappers = container.querySelectorAll(
        '.reorder-grid > .drag-card-wrapper'
      ) as NodeListOf<HTMLElement>;
      wrappers.forEach(el => {
        el.style.transition = '';
        el.style.transform = '';
      });
    }

    this.flipPositionCache.clear();
  }

  setupScrollFade(): void {
    const container = this.mainContent?.nativeElement;
    if (!container) return;

    // Run scroll fade outside Angular zone to avoid change detection on every scroll
    this.scrollListener = () => {
      // Skip expensive DOM queries during drag to avoid jank
      if (this.isDragging) return;

      const containerRect = container.getBoundingClientRect();
      const fadeZone = 80;

      const rowElements = container.querySelectorAll(
        '.category-divider, .sub-category-divider, app-sound-card'
      ) as NodeListOf<HTMLElement>;

      const rowGroups = new Map<number, HTMLElement[]>();
      rowElements.forEach((el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        const rowKey = Math.round(rect.top / 4) * 4;
        if (!rowGroups.has(rowKey)) {
          rowGroups.set(rowKey, []);
        }
        rowGroups.get(rowKey)!.push(el);
      });

      rowGroups.forEach((els) => {
        const rect = els[0].getBoundingClientRect();
        const rowTop = rect.top;
        const rowBottom = rect.bottom;

        const topClip = containerRect.top - rowTop;
        const bottomClip = rowBottom - containerRect.bottom;
        const clip = Math.max(topClip, bottomClip, 0);
        const opacity = clip === 0 ? 1 : Math.max(0, 1 - clip / fadeZone);

        els.forEach(el => {
          el.style.opacity = String(opacity);
        });
      });

      this.updateActiveCategory(container, containerRect);
    };

    this.ngZone.runOutsideAngular(() => {
      container.addEventListener('scroll', this.scrollListener!, { passive: true });
    });
    this.scrollListener();
  }

  private getSnapPoints(container: HTMLElement): number[] {
    const cards = container.querySelectorAll('app-sound-card') as NodeListOf<HTMLElement>;
    if (!cards.length) return [];

    const containerTop = container.getBoundingClientRect().top;

    const navOffset = this.categoryNavList?.nativeElement
      ? this.categoryNavList.nativeElement.getBoundingClientRect().top - containerTop
      : 0;

    let stickyDividerHeight = 0;
    const sampleDivider = container.querySelector('.category-divider') as HTMLElement | null;
    if (sampleDivider) {
      stickyDividerHeight = sampleDivider.offsetHeight;
    }

    const categorySections = container.querySelectorAll('.category-section') as NodeListOf<HTMLElement>;
    const categorySnapPoints: number[] = [];
    categorySections.forEach((section: HTMLElement) => {
      const sectionTop = section.getBoundingClientRect().top - containerTop + container.scrollTop;
      categorySnapPoints.push(Math.max(0, sectionTop - navOffset));
    });

    const subCategoryDividers = container.querySelectorAll('.sub-category-divider') as NodeListOf<HTMLElement>;
    const subCategorySnapPoints: number[] = [];
    subCategoryDividers.forEach((divider: HTMLElement) => {
      const dividerTop = divider.getBoundingClientRect().top - containerTop + container.scrollTop;
      const snapPoint = Math.max(0, dividerTop - navOffset - stickyDividerHeight);
      subCategorySnapPoints.push(snapPoint);
    });

    const rowMap = new Map<number, number>();
    cards.forEach((card: HTMLElement) => {
      const cardTop = card.getBoundingClientRect().top - containerTop + container.scrollTop;
      const bucket = Math.round(cardTop / 4) * 4;
      if (!rowMap.has(bucket)) {
        rowMap.set(bucket, cardTop);
      }
    });

    const snapSet = new Set<number>();

    categorySnapPoints.forEach(p => snapSet.add(Math.round(p)));

    subCategorySnapPoints.forEach(p => {
      const rounded = Math.round(p);
      const coveredByCategory = categorySnapPoints.some(cp => Math.abs(cp - p) < 8);
      if (!coveredByCategory) {
        snapSet.add(rounded);
      }
    });

    const allHeaderSnapPoints = [...categorySnapPoints, ...subCategorySnapPoints];

    const sortedCardTops = Array.from(rowMap.values()).sort((a, b) => a - b);
    sortedCardTops.forEach(cardTop => {
      const snapPoint = Math.max(0, cardTop - navOffset - stickyDividerHeight);
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

    this.ngZone.runOutsideAngular(() => {
    this.snapWheelListener = (e: WheelEvent) => {
      if (this.isSnapping || this.isDragging) return;

      this.lastWheelDeltaY += e.deltaY;

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
        this.lastWheelDeltaY = 0;

        let target: number | null = null;

        if (scrollingDown) {
          for (const point of snapPoints) {
            if (point >= currentScroll - 2) {
              target = point;
              break;
            }
          }
          if (target === null) target = snapPoints[snapPoints.length - 1];
        } else {
          const reversed = [...snapPoints].reverse();
          for (const point of reversed) {
            if (point <= currentScroll + 2) {
              target = point;
              break;
            }
          }
          if (target === null) target = snapPoints[0];
        }

        if (Math.abs(currentScroll - target) > 2) {
          this.isSnapping = true;
          this.fastScrollTo(container, target, 200);
          setTimeout(() => { this.isSnapping = false; }, 250);
        }
      }, 80);
    };

    container.addEventListener('wheel', this.snapWheelListener!, { passive: true });
    }); // end runOutsideAngular for wheel

    this.ngZone.runOutsideAngular(() => {
    this.snapScrollListener = () => {
      if (this.isSnapping || this.isDragging) return;

      if (this.snapScrollDebounceTimer) {
        clearTimeout(this.snapScrollDebounceTimer);
      }

      this.snapScrollDebounceTimer = setTimeout(() => {
        this.snapScrollDebounceTimer = null;
        if (this.isSnapping) return;

        const snapPoints = this.getSnapPoints(container);
        if (!snapPoints.length) return;

        const currentScroll = container.scrollTop;

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

    container.addEventListener('scroll', this.snapScrollListener!, { passive: true });
    }); // end runOutsideAngular for scroll snap
  }

  updateActiveCategory(container: HTMLElement, containerRect: DOMRect): void {
    const categorySections = container.querySelectorAll('.category-section[data-category]') as NodeListOf<HTMLElement>;
    let current = '';
    categorySections.forEach((section: HTMLElement) => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= containerRect.top + 80) {
        current = section.getAttribute('data-category') || '';
      }
    });
    if (current && current !== this.activeCategory) {
      // Re-enter Angular zone to emit the active category change
      this.ngZone.run(() => {
        this.activeCategoryChange.emit(current);
        this.cdr.markForCheck();
      });
    } else if (!current && this.categories.length > 0 && !this.activeCategory) {
      this.ngZone.run(() => {
        this.activeCategoryChange.emit(this.categories[0].name);
        this.cdr.markForCheck();
      });
    }
  }

  scrollToCategory(categoryName: string): void {
    const container = this.mainContent?.nativeElement;
    if (!container) return;
    const section = container.querySelector(`.category-section[data-category="${CSS.escape(categoryName)}"]`) as HTMLElement | null;
    if (section) {
      this.activeCategoryChange.emit(categoryName);
      const containerRect = container.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();

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
      const ease = 1 - Math.pow(1 - progress, 3);
      element.scrollTop = startY + distance * ease;
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }

  updateSpacerHeight(): void {
    const container = this.mainContent?.nativeElement as HTMLElement | undefined;
    const spacer = this.scrollEndSpacer?.nativeElement as HTMLElement | undefined;
    if (!container || !spacer) return;

    spacer.style.height = '0px';

    const categorySections = container.querySelectorAll('.category-section') as NodeListOf<HTMLElement>;
    if (!categorySections.length) {
      return;
    }

    const containerRect = container.getBoundingClientRect();

    const navOffset = this.categoryNavList?.nativeElement
      ? this.categoryNavList.nativeElement.getBoundingClientRect().top - containerRect.top
      : 0;

    const lastSection = categorySections[categorySections.length - 1];

    const spacerHeight = Math.max(0, container.clientHeight - navOffset - lastSection.offsetHeight);
    spacer.style.height = `${spacerHeight}px`;
  }

  trackByCategory(index: number, category: Category): string {
    return category.name;
  }

  trackByIndex(index: number, sound: Sound): number {
    return sound.index;
  }

  getTotalSoundCount(category: Category): number {
    const subTotal = category.subCategories.reduce((sum, sub) => sum + sub.sounds.length, 0);
    return category.sounds.length + subTotal;
  }

  onPlaySound(sound: Sound): void {
    this.playSound.emit(sound);
  }

  onOpenRenameModal(sound: Sound): void {
    this.openRenameModal.emit(sound);
  }

  onSoundContextMenu(event: { sound: Sound; event: MouseEvent }): void {
    this.soundContextMenu.emit(event);
  }

}
