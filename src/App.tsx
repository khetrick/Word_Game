import { useEffect, useMemo, useRef, useState } from 'react';
import { DICTIONARY } from './dictionary';

const ROWS = 10;
const COLS = 6;
const STORAGE_KEY = 'word-drop-high-score';
const LEADERBOARD_KEY = 'word-drop-leaderboard';

const letterPool = [
  ...'EEEEEEEEEEEEEEEEAAAAAAAIIIIIIIIOOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUUDDDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ'
];

const SCRABBLE_VALUES: Record<string, number> = {
  A: 1,
  B: 3,
  C: 3,
  D: 2,
  E: 1,
  F: 4,
  G: 2,
  H: 4,
  I: 1,
  J: 8,
  K: 5,
  L: 1,
  M: 3,
  N: 1,
  O: 1,
  P: 3,
  Q: 10,
  R: 1,
  S: 1,
  T: 1,
  U: 1,
  V: 4,
  W: 4,
  X: 8,
  Y: 4,
  Z: 10
};

const lengthMultiplier = (length: number) => {
  if (length >= 7) return 6;
  if (length === 6) return 4;
  if (length === 5) return 2.5;
  if (length === 4) return 1.5;
  return 1;
};

const comboMultiplier = (combo: number) => {
  if (combo >= 4) return 2;
  if (combo === 3) return 1.5;
  if (combo === 2) return 1.25;
  return 1;
};

type Tile = string | null;

type CellPos = {
  row: number;
  col: number;
};

const createEmptyBoard = (): Tile[][] =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));

const cloneBoard = (board: Tile[][]): Tile[][] => board.map((row) => [...row]);

const getTopFreeColumns = (board: Tile[][]) =>
  board[0]
    .map((cell, col) => (cell === null ? col : -1))
    .filter((col) => col >= 0);

const dropTile = (board: Tile[][], col: number, letter: string) => {
  const nextBoard = cloneBoard(board);
  let row = 0;
  while (row + 1 < ROWS && nextBoard[row + 1][col] === null) {
    row += 1;
  }
  nextBoard[row][col] = letter;
  return nextBoard;
};

const applyGravity = (board: Tile[][]) => {
  const nextBoard = cloneBoard(board);
  for (let col = 0; col < COLS; col += 1) {
    const letters: string[] = [];
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const tile = nextBoard[row][col];
      if (tile) {
        letters.push(tile);
      }
      nextBoard[row][col] = null;
    }
    for (let row = ROWS - 1; row >= 0 && letters.length > 0; row -= 1) {
      nextBoard[row][col] = letters.shift() ?? null;
    }
  }
  return nextBoard;
};

const randomLetter = () => letterPool[Math.floor(Math.random() * letterPool.length)];

const isTopRowFull = (board: Tile[][]) => board[0].every((cell) => cell !== null);

const adjacent = (a: CellPos, b: CellPos) =>
  Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)) === 1;

const computeScore = (word: string) => {
  const base = [...word].reduce((sum, letter) => sum + (SCRABBLE_VALUES[letter] ?? 0), 0);
  return base * lengthMultiplier(word.length);
};

const createAudioContext = () => {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  return new AudioContext();
};

const playTone = (ctx: AudioContext, frequency: number, duration: number, type: OscillatorType) => {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gainNode.gain.setValueAtTime(0.18, ctx.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
};

const playSuccessSound = (ctx: AudioContext) => {
  playTone(ctx, 440, 0.12, 'triangle');
  playTone(ctx, 580, 0.12, 'sine');
  playTone(ctx, 720, 0.12, 'triangle');
};

const playInvalidSound = (ctx: AudioContext) => {
  playTone(ctx, 220, 0.08, 'sawtooth');
  playTone(ctx, 180, 0.1, 'sawtooth');
};

const playSelectSound = (ctx: AudioContext) => {
  playTone(ctx, 660, 0.06, 'sine');
};

const isValidWord = (word: string, dictionary: Set<string>): boolean => {
  const lower = word.toLowerCase();
  if (dictionary.has(lower)) return true;
  
  // Check plural: if word ends in 'S', also check singular form
  if (lower.endsWith('s') && lower.length > 1) {
    const singular = lower.slice(0, -1);
    if (dictionary.has(singular)) return true;
  }
  
  return false;
};

function App() {
  const [board, setBoard] = useState<Tile[][]>(createEmptyBoard());
  const [selected, setSelected] = useState<CellPos[]>([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<number[]>([]);
  const [newScoreIndex, setNewScoreIndex] = useState(-1);
  const [longestWord, setLongestWord] = useState('');
  const [highestScoringWord, setHighestScoringWord] = useState('');
  const [highestWordScore, setHighestWordScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [status, setStatus] = useState<'playing' | 'gameover'>('playing');
  const [invalid, setInvalid] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const lastSuccessTime = useRef(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<CellPos | null>(null);
  const [wordRewardType, setWordRewardType] = useState<'big' | 'huge' | null>(null);
  const [recoveryActive, setRecoveryActive] = useState(false);
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false); // Use ref to avoid stale closure issues
  const isPointerDownRef = useRef(false); // Track if pointer is currently down
  const didDragRef = useRef(false); // Track if a drag occurred during this pointer session
  const DRAG_THRESHOLD = 8; // pixels required to consider it a drag

  const getAudioContext = () => {
    if (!audioRef.current) {
      audioRef.current = createAudioContext();
    }
    return audioRef.current;
  };

  const selectedWord = useMemo(
    () => selected.map(({ row, col }) => board[row][col]).join('') as string,
    [board, selected]
  );

  useEffect(() => {
    const storedHighScore = window.localStorage.getItem(STORAGE_KEY);
    const storedLeaderboard = window.localStorage.getItem(LEADERBOARD_KEY);
    if (storedHighScore) {
      setHighScore(Number(storedHighScore) || 0);
    }
    if (storedLeaderboard) {
      try {
        setLeaderboard(JSON.parse(storedLeaderboard));
      } catch {
        setLeaderboard([]);
      }
    }
    startNewGame();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(highScore));
  }, [highScore]);

  useEffect(() => {
    window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard));
  }, [leaderboard]);

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const interval = window.setInterval(() => {
      setBoard((prev) => {
        const free = getTopFreeColumns(prev);
        if (free.length === 0) {
          setStatus('gameover');
          setShowGameOver(true);
          return prev;
        }
        const next = dropTile(prev, free[Math.floor(Math.random() * free.length)], randomLetter());
        if (isTopRowFull(next)) {
          setStatus('gameover');
          setShowGameOver(true);
        }
        return next;
      });
    }, 1700);
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
    }
  }, [score, highScore]);

  useEffect(() => {
    if (status === 'gameover') {
      handleLeaderboardUpdate(score);
    }
  }, [status, score]);

  const spawnInitialTiles = (boardState: Tile[][]) => {
    let nextBoard = cloneBoard(boardState);
    for (let i = 0; i < 4; i += 1) {
      const free = getTopFreeColumns(nextBoard);
      if (free.length === 0) break;
      nextBoard = dropTile(nextBoard, free[Math.floor(Math.random() * free.length)], randomLetter());
    }
    return nextBoard;
  };

  const startNewGame = () => {
    const empty = createEmptyBoard();
    const seeded = spawnInitialTiles(empty);
    setBoard(seeded);
    setSelected([]);
    setScore(0);
    setCombo(0);
    setStatus('playing');
    setInvalid(false);
    setHighestScoringWord('');
    setHighestWordScore(0);
    setShowGameOver(false);
    setNewScoreIndex(-1);
    setWordRewardType(null);
    setRecoveryActive(false);
    if (recoveryTimeoutRef.current) {
      clearTimeout(recoveryTimeoutRef.current);
      recoveryTimeoutRef.current = null;
    }
    lastSuccessTime.current = 0;
  };

  const handleLeaderboardUpdate = (finalScore: number) => {
    // Create a new leaderboard with the final score
    const tempLeaderboard = [...leaderboard];
    
    // Check if the score qualifies for top 5
    if (tempLeaderboard.length < 5 || finalScore > tempLeaderboard[tempLeaderboard.length - 1]) {
      tempLeaderboard.push(finalScore);
      tempLeaderboard.sort((a, b) => b - a);
      const newLeaderboard = tempLeaderboard.slice(0, 5);
      
      // Find the index of the newly inserted score
      const insertedIndex = newLeaderboard.indexOf(finalScore);
      
      setLeaderboard(newLeaderboard);
      setNewScoreIndex(insertedIndex);
    } else {
      setNewScoreIndex(-1);
    }
  };

  const handleClickTap = (row: number, col: number) => {
    // Called when a click/tap is confirmed (minimal movement)
    if (status !== 'playing') return;
    
    const currentPos = { row, col };
    const index = selected.findIndex((pos) => pos.row === row && pos.col === col);
    
    // Click on already-selected tile: clear entire selection
    if (index >= 0) {
      setSelected([]);
      return;
    }
    
    // Click on empty space: ignore (handled by handleBoardClick)
    if (!board[row][col]) {
      return;
    }
    
    // Click on unselected tile adjacent to last selected: add to path
    if (selected.length === 0) {
      setSelected([currentPos]);
      const ctx = getAudioContext();
      playSelectSound(ctx);
      return;
    }
    
    const lastSelected = selected[selected.length - 1];
    if (adjacent(lastSelected, currentPos)) {
      setSelected((prev) => [...prev, currentPos]);
      const ctx = getAudioContext();
      playSelectSound(ctx);
      return;
    }
    
    // Click on non-adjacent unselected tile: ignore (only drag can start new path)
  };

  const handleBoardClick = (e: React.MouseEvent) => {
    // Click on empty space or outside grid clears selection
    // BUT: Do NOT clear if a drag just occurred
    if (status !== 'playing') return;
    if (didDragRef.current) {
      console.log("DRAG_JUST_OCCURRED - not clearing selection on click");
      didDragRef.current = false; // Reset for next interaction
      return;
    }
    
    const target = e.target as HTMLElement;
    
    // Check if click was on empty cell or board itself, not on a tile
    // Need to check both the target and if it's inside a tile button
    const isEmptyCell = target.classList.contains('empty');
    const isBoardItself = target.classList.contains('board');
    const isInsideTile = target.closest('.cell.tile') !== null;
    
    // Only clear if definitely clicking empty space, not inside a tile
    if ((isEmptyCell || isBoardItself) && !isInsideTile) {
      console.log("CLEAR_FROM: handleBoardClick (empty space)");
      setSelected([]);
    }
  };

  const handleMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    if (status !== 'playing') return;
    
    // Track starting position to calculate movement distance
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    setDragStartPos({ row, col });
    isPointerDownRef.current = true;
    didDragRef.current = false; // Reset drag flag at start of new pointer session
    isDraggingRef.current = false; // Start as false, will set to true if movement exceeds threshold
    console.log("POINTER_DOWN");
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStartPos || !pointerStartRef.current) return;
    
    // Calculate distance moved
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Only start drag if movement exceeds threshold
    if (distance < DRAG_THRESHOLD) return;
    
    if (!isDraggingRef.current) {
      // First time crossing threshold: initialize drag selection
      isDraggingRef.current = true;
      didDragRef.current = true; // Mark that a drag occurred
      console.log("DRAG_STARTED");
      const index = selected.findIndex((pos) => pos.row === dragStartPos.row && pos.col === dragStartPos.col);
      if (index >= 0) {
        // Dragging from already-selected tile: keep selection as is, allow backtrack
      } else if (board[dragStartPos.row][dragStartPos.col]) {
        // Dragging from unselected tile: start new selection
        setSelected([dragStartPos]);
        const ctx = getAudioContext();
        playSelectSound(ctx);
      }
    }
  };

  const handleMouseEnter = (row: number, col: number) => {
    if (!isDraggingRef.current || status !== 'playing' || !board[row][col] || !dragStartPos) return;
    
    const currentPos = { row, col };
    const lastSelected = selected[selected.length - 1];
    
    // Support backtracking: if dragging back to previous tile, remove last tile
    if (selected.length > 1 && lastSelected.row === row && lastSelected.col === col) {
      // Already at this tile, don't add again
      return;
    }
    
    if (selected.length > 0) {
      const prevTile = selected[selected.length - 2] || null;
      if (prevTile && prevTile.row === row && prevTile.col === col) {
        // Dragging back to previous tile: remove last selection
        setSelected(prev => prev.slice(0, -1));
        const ctx = getAudioContext();
        playSelectSound(ctx);
        return;
      }
    }
    
    // Normal drag: extend path if adjacent
    if (selected.length === 0 || adjacent(lastSelected, currentPos)) {
      const alreadySelected = selected.some(pos => pos.row === row && pos.col === col);
      if (!alreadySelected) {
        setSelected(prev => [...prev, currentPos]);
        const ctx = getAudioContext();
        playSelectSound(ctx);
      }
    }
  };

  const handleMouseUp = (row: number | null, col: number | null) => {
    console.log("POINTER_UP - isDrag:", isDraggingRef.current, "didDrag:", didDragRef.current, "row:", row, "col:", col);
    isPointerDownRef.current = false;
    
    // Store drag state before resetting
    const wasDrag = didDragRef.current;
    
    // Only apply click/tap clearing if NO drag occurred
    if (!wasDrag && dragStartPos && row === dragStartPos.row && col === dragStartPos.col) {
      console.log("HANDLING_CLICK_TAP");
      handleClickTap(row, col);
    } else if (wasDrag) {
      console.log("DRAG_OCCURRED - NOT clearing selection, keeping selection for Submit");
      // Drag occurred - DO NOT clear selection
      // Selection remains visible for player to press Submit
    }
    
    // Reset drag tracking for next pointer session
    isDraggingRef.current = false;
    // Delay resetting didDragRef so click handlers don't see stale state
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
    setDragStartPos(null);
    pointerStartRef.current = null;
  };

  const handleTouchStart = (row: number, col: number, e: React.TouchEvent) => {
    if (status !== 'playing') return;
    e.preventDefault();
    
    const touch = e.touches[0];
    pointerStartRef.current = { x: touch.clientX, y: touch.clientY };
    setDragStartPos({ row, col });
    isPointerDownRef.current = true;
    didDragRef.current = false; // Reset drag flag at start of new pointer session
    isDraggingRef.current = false; // Start as false, will set to true if movement exceeds threshold
    console.log("TOUCH_START");
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStartPos || !pointerStartRef.current) return;
    
    const touch = e.touches[0];
    
    // Calculate distance moved
    const dx = Math.abs(touch.clientX - pointerStartRef.current.x);
    const dy = Math.abs(touch.clientY - pointerStartRef.current.y);
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Only start drag if movement exceeds threshold
    if (distance < DRAG_THRESHOLD) return;
    
    if (!isDraggingRef.current) {
      // First time crossing threshold: initialize drag
      isDraggingRef.current = true;
      didDragRef.current = true; // Mark that a drag occurred
      console.log("TOUCH_DRAG_STARTED");
      const index = selected.findIndex((pos) => pos.row === dragStartPos.row && pos.col === dragStartPos.col);
      if (index === -1 && board[dragStartPos.row][dragStartPos.col]) {
        // Start new selection from unselected tile
        setSelected([dragStartPos]);
        const ctx = getAudioContext();
        playSelectSound(ctx);
      }
    }
    
    // Now handle the actual drag movement
    if (isDraggingRef.current) {
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      if (element && element.classList.contains('cell') && element.classList.contains('tile')) {
        const row = parseInt(element.getAttribute('data-row') || '0');
        const col = parseInt(element.getAttribute('data-col') || '0');
        
        const currentPos = { row, col };
        const lastSelected = selected[selected.length - 1];
        
        // Support backtracking: if dragging back to previous tile, remove last tile
        if (selected.length > 1) {
          const prevTile = selected[selected.length - 2];
          if (prevTile && prevTile.row === row && prevTile.col === col) {
            setSelected(prev => prev.slice(0, -1));
            const ctx = getAudioContext();
            playSelectSound(ctx);
            return;
          }
        }
        
        // Normal drag: extend path if adjacent
        if (selected.length === 0 || adjacent(lastSelected, currentPos)) {
          const alreadySelected = selected.some(pos => pos.row === row && pos.col === col);
          if (!alreadySelected) {
            setSelected(prev => [...prev, currentPos]);
            const ctx = getAudioContext();
            playSelectSound(ctx);
          }
        }
      }
    }
  };

  const handleTouchEnd = (row: number | null, col: number | null) => {
    console.log("TOUCH_END - isDrag:", isDraggingRef.current, "didDrag:", didDragRef.current, "row:", row, "col:", col);
    isPointerDownRef.current = false;
    
    // Store drag state before resetting
    const wasDrag = didDragRef.current;
    
    // Only apply tap clearing if NO drag occurred
    if (!wasDrag && dragStartPos && row === dragStartPos.row && col === dragStartPos.col) {
      console.log("HANDLING_TAP");
      handleClickTap(row, col);
    } else if (wasDrag) {
      console.log("TOUCH_DRAG_OCCURRED - NOT clearing selection, keeping selection for Submit");
      // Drag occurred - DO NOT clear selection
      // Selection remains visible for player to press Submit
    }
    
    // Reset drag tracking for next pointer session
    isDraggingRef.current = false;
    // Delay resetting didDragRef so click handlers don't see stale state
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
    setDragStartPos(null);
    pointerStartRef.current = null;
  };

  const handleSubmit = () => {
    const word = selectedWord;
    if (word.length < 3 || !isValidWord(word, DICTIONARY)) {
      setInvalid(true);
      setSelected([]);
      const ctx = getAudioContext();
      playInvalidSound(ctx);
      window.setTimeout(() => setInvalid(false), 420);
      return;
    }

    const ctx = getAudioContext();
    playSuccessSound(ctx);

    setBoard((prev) => {
      const next = cloneBoard(prev);
      selected.forEach(({ row, col }) => {
        next[row][col] = null;
      });
      const gravityBoard = applyGravity(next);
      
      // Recovery mechanic: after 5+ letter words, clear one random extra tile
      // This gives a skill-based second chance when the board is filling up
      let recoveryBoard = gravityBoard;
      if (word.length >= 5 && isTopRowFull(gravityBoard) === false) {
        // Find all non-empty tiles
        const allTiles: CellPos[] = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (recoveryBoard[r][c] !== null) {
              allTiles.push({ row: r, col: c });
            }
          }
        }
        // Clear a random tile if we have tiles to clear
        if (allTiles.length > 0) {
          const randomTile = allTiles[Math.floor(Math.random() * allTiles.length)];
          recoveryBoard[randomTile.row][randomTile.col] = null;
          recoveryBoard = applyGravity(recoveryBoard);
          setRecoveryActive(true);
          if (recoveryTimeoutRef.current) clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = window.setTimeout(() => setRecoveryActive(false), 600);
        }
      }
      
      if (isTopRowFull(recoveryBoard)) {
        setStatus('gameover');
        setShowGameOver(true);
      }
      return recoveryBoard;
    });

    const now = Date.now();
    const nextCombo = now - lastSuccessTime.current <= 5000 ? combo + 1 : 1;
    lastSuccessTime.current = now;
    setCombo(nextCombo);

    const baseScore = computeScore(word);
    const total = Math.round(baseScore * comboMultiplier(nextCombo));
    setScore((prev) => prev + total);
    setLongestWord((prev) => (word.length > prev.length ? word : prev));

    // Track highest scoring word
    if (total > highestWordScore) {
      setHighestScoringWord(word);
      setHighestWordScore(total);
    }

    // Show reward animation for long words
    if (word.length >= 6) {
      setWordRewardType('huge');
    } else if (word.length >= 5) {
      setWordRewardType('big');
    }
    
    window.setTimeout(() => setWordRewardType(null), 1200);
    setSelected([]);
  };

  const handleClear = () => {
    setSelected([]);
    setInvalid(false);
  };

  return (
    <div className="app">
      <div className="title-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ margin: 0 }}>Word Drop</h1>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#4a90e2' }}>
            Score: {score}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="secondary" onClick={() => setShowInfo(true)} style={{ padding: '8px', minHeight: 'auto', fontSize: '1.2rem' }}>
            ℹ️
          </button>
          <button className="secondary" onClick={startNewGame}>
            Restart
          </button>
        </div>
      </div>

      <div className={`board${invalid ? ' shake' : ''} ${recoveryActive ? 'recovery-flash' : ''}${wordRewardType ? ` reward-${wordRewardType}` : ''}`} onClick={handleBoardClick} onMouseUp={(e) => { if (e.target === e.currentTarget) handleMouseUp(null, null); }} onMouseLeave={(e) => handleMouseUp(null, null)} onMouseMove={handleMouseMove}>
        {board.flatMap((row, rowIndex) =>
          row.map((letter, colIndex) => {
            const isSelected = selected.some((pos) => pos.row === rowIndex && pos.col === colIndex);
            const pointValue = letter ? SCRABBLE_VALUES[letter] || 0 : 0;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                className={`cell ${letter ? 'tile' : 'empty'} ${isSelected ? 'selected' : ''} ${status === 'gameover' ? 'game-over' : ''}`}
                onMouseDown={(e) => handleMouseDown(rowIndex, colIndex, e)}
                onMouseUp={(e) => { e.stopPropagation(); handleMouseUp(rowIndex, colIndex); }}
                onMouseEnter={() => handleMouseEnter(rowIndex, colIndex)}
                onTouchStart={(e) => handleTouchStart(rowIndex, colIndex, e)}
                onTouchMove={handleTouchMove}
                onTouchEnd={(e) => { e.stopPropagation(); handleTouchEnd(rowIndex, colIndex); }}
                data-row={rowIndex}
                data-col={colIndex}
              >
                <span className="tile-letter">{letter || ''}</span>
                {letter && <span className="tile-points">{pointValue}</span>}
              </button>
            );
          })
        )}
      </div>

      <div className="controls">
        <div className="panel">
          <div className={`selected-word${invalid ? ' flash' : ''}${wordRewardType ? ' reward-pulse' : ''}`}>
            <p>
              <span className="word-keyword">Word</span>: {selectedWord || 'Tap tiles'}
            </p>
            <p>{selected.length} tile{selected.length === 1 ? '' : 's'}
              {wordRewardType === 'huge' && <span className="reward-badge huge-badge">HUGE!</span>}
              {wordRewardType === 'big' && <span className="reward-badge big-badge">BIG!</span>}
            </p>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={handleClear} disabled={selected.length === 0}>
              Clear
            </button>
            <button className="primary" onClick={handleSubmit} disabled={selected.length < 3 || status !== 'playing'}>
              Submit
            </button>
          </div>
        </div>
      </div>

      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>How to Play</h2>
              <button className="modal-close" onClick={() => setShowInfo(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="info-section">
                <h3>🎯 Objective</h3>
                <p>Tap adjacent tiles to build words, then submit before the board fills from the top!</p>
              </div>

              <div className="info-section">
                <h3>🎮 How to Play</h3>
                <ul>
                  <li>Tap or drag across tiles that are horizontally, vertically, or diagonally adjacent</li>
                  <li>Tap a selected tile to clear all selections</li>
                  <li>Build words of 3+ letters</li>
                  <li>Submit valid words to clear tiles and earn points</li>
                  <li>New tiles fall every 1.7 seconds</li>
                  <li>Game ends when tiles reach the top row</li>
                </ul>
              </div>

              <div className="info-section">
                <h3>🏆 Scoring</h3>
                <div className="scoring-info">
                  <div>
                    <strong>Letter Values:</strong> Scrabble-style points (A=1, B=3, C=3, etc.)
                  </div>
                  <div>
                    <strong>Length Bonus:</strong>
                    <br />• 3 letters = 1x multiplier
                    <br />• 4 letters = 1.5x multiplier
                    <br />• 5 letters = 2.5x multiplier
                    <br />• 6 letters = 4x multiplier
                    <br />• 7+ letters = 6x multiplier
                  </div>
                  <div>
                    <strong>Combo Bonus:</strong>
                    <br />• 1 word = 1x multiplier
                    <br />• 2 words = 1.25x multiplier
                    <br />• 3 words = 1.5x multiplier
                    <br />• 4+ words = 2x multiplier
                    <br />• (within 5 seconds of previous submission)
                  </div>
                </div>
              </div>

              <div className="info-section">
                <h3>🎵 Sounds</h3>
                <p>• Success chime for valid words</p>
                <p>• Error buzz for invalid words</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGameOver && (
        <div className="modal-overlay" onClick={() => setShowGameOver(false)}>
          <div className="modal-content game-over-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🎮 Game Over!</h2>
              <button className="modal-close" onClick={() => setShowGameOver(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="game-over-stats">
                <div className="stat-item">
                  <span className="stat-label">Final Score:</span>
                  <span className="stat-value">{score}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Highest Scoring Word:</span>
                  <span className="stat-value">
                    {highestScoringWord ? `${highestScoringWord} (${highestWordScore} pts)` : 'None'}
                  </span>
                </div>
              </div>

              <div className="leaderboard-section">
                <h3>🏆 Top 5 High Scores</h3>
                <div className="leaderboard">
                  {leaderboard.length > 0 ? (
                    leaderboard.map((score, index) => (
                      <div key={index} className={`leaderboard-item ${score === highScore ? 'current-high' : ''} ${index === newScoreIndex ? 'new-score' : ''}`}>
                        <span className="rank">#{index + 1}</span>
                        <span className="score">{score.toLocaleString()}</span>
                        {score === highScore && <span className="high-score-badge">⭐</span>}
                        {index === newScoreIndex && <span className="new-score-badge">✨</span>}
                      </div>
                    ))
                  ) : (
                    <div className="no-scores">No scores yet - play to set records!</div>
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button className="primary restart-btn" onClick={startNewGame}>
                  🎯 Play Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
