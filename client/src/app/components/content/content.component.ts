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
import { CdkDragDrop, CdkDragStart, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
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
  @Output() dragStateChange = new EventEmitter<boolean>();

  @ViewChild('mainContent') mainContent!: ElementRef;
  @ViewChild('categoryNavList') categoryNavList!: ElementRef;
  @ViewChild('scrollEndSpacer') scrollEndSpacer!: ElementRef<HTMLElement>;

  isDragging = false;

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
    category.image = '';
    this.cdr.markForCheck();
  }

  onDragStarted(_event: CdkDragStart): void {
    this.isDragging = true;
    this.dragStateChange.emit(true);
    this.cdr.markForCheck();
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
    this.isDragging = false;
    this.dragStateChange.emit(false);
    this.cdr.markForCheck();
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
}
