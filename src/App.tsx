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

function App() {
  const [board, setBoard] = useState<Tile[][]>(createEmptyBoard());
  const [selected, setSelected] = useState<CellPos[]>([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<number[]>([]);
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
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<CellPos | null>(null);

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
          updateLeaderboard(score);
          return prev;
        }
        const next = dropTile(prev, free[Math.floor(Math.random() * free.length)], randomLetter());
        if (isTopRowFull(next)) {
          setStatus('gameover');
          setShowGameOver(true);
          updateLeaderboard(score);
        }
        return next;
      });
    }, 1700);
    return () => window.clearInterval(interval);
  }, [status, score]);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
    }
  }, [score, highScore]);

  useEffect(() => {
    if (status === 'gameover') {
      updateLeaderboard(score);
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
    lastSuccessTime.current = 0;
  };

  const updateLeaderboard = (finalScore: number) => {
    const newLeaderboard = [...leaderboard, finalScore]
      .sort((a, b) => b - a)
      .slice(0, 5);
    setLeaderboard(newLeaderboard);
  };

  const toggleSelect = (row: number, col: number) => {
    if (status !== 'playing') return;
    if (!board[row][col]) return;
    const index = selected.findIndex((pos) => pos.row === row && pos.col === col);
    if (index >= 0) {
      // If tile is already selected, clear all selections
      setSelected([]);
      return;
    }
    if (selected.length === 0 || adjacent(selected[selected.length - 1], { row, col })) {
      setSelected((prev) => [...prev, { row, col }]);
      const ctx = getAudioContext();
      playSelectSound(ctx);
    }
  };

  const handleMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    if (status !== 'playing' || !board[row][col]) return;
    // Only start dragging if it's not a simple click
    // We'll determine this by checking if mouse moves before mouse up
    setDragStartPos({ row, col });
    setIsDragging(false); // Start as false, will set to true on mouse move
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStartPos || isDragging) return;
    // If mouse has moved while pressed, start dragging
    setIsDragging(true);
    const index = selected.findIndex((pos) => pos.row === dragStartPos.row && pos.col === dragStartPos.col);
    if (index >= 0) {
      setSelected([]);
    } else {
      setSelected([dragStartPos]);
      const ctx = getAudioContext();
      playSelectSound(ctx);
    }
  };

  const handleMouseEnter = (row: number, col: number) => {
    if (!isDragging || status !== 'playing' || !board[row][col] || !dragStartPos) return;
    
    const currentPos = { row, col };
    const lastSelected = selected[selected.length - 1];
    
    // Only allow selection if adjacent to the last selected tile or if it's the first tile
    if (selected.length === 0 || adjacent(lastSelected, currentPos)) {
      const alreadySelected = selected.some(pos => pos.row === row && pos.col === col);
      if (!alreadySelected) {
        setSelected(prev => [...prev, currentPos]);
        const ctx = getAudioContext();
        playSelectSound(ctx);
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStartPos(null);
  };

  const handleTouchStart = (row: number, col: number, e: React.TouchEvent) => {
    if (status !== 'playing' || !board[row][col]) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStartPos({ row, col });
    // Start new selection or toggle existing
    const index = selected.findIndex((pos) => pos.row === row && pos.col === col);
    if (index >= 0) {
      setSelected([]);
    } else {
      setSelected([{ row, col }]);
      const ctx = getAudioContext();
      playSelectSound(ctx);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || status !== 'playing' || !dragStartPos) return;
    
    const touch = e.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (element && element.classList.contains('cell') && element.classList.contains('tile')) {
      const row = parseInt(element.getAttribute('data-row') || '0');
      const col = parseInt(element.getAttribute('data-col') || '0');
      
      const currentPos = { row, col };
      const lastSelected = selected[selected.length - 1];
      
      // Only allow selection if adjacent to the last selected tile
      if (selected.length === 0 || adjacent(lastSelected, currentPos)) {
        const alreadySelected = selected.some(pos => pos.row === row && pos.col === col);
        if (!alreadySelected) {
          setSelected(prev => [...prev, currentPos]);
          const ctx = getAudioContext();
          playSelectSound(ctx);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setDragStartPos(null);
  };

  const handleSubmit = () => {
    const word = selectedWord;
    if (word.length < 3 || !DICTIONARY.has(word.toLowerCase())) {
      setInvalid(true);
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
      if (isTopRowFull(gravityBoard)) {
        setStatus('gameover');
        setShowGameOver(true);
      }
      return gravityBoard;
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

      <div className={`board${invalid ? ' shake' : ''}`} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onMouseMove={handleMouseMove}>
        {board.flatMap((row, rowIndex) =>
          row.map((letter, colIndex) => {
            const isSelected = selected.some((pos) => pos.row === rowIndex && pos.col === colIndex);
            const pointValue = letter ? SCRABBLE_VALUES[letter] || 0 : 0;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                className={`cell ${letter ? 'tile' : 'empty'} ${isSelected ? 'selected' : ''} ${status === 'gameover' ? 'game-over' : ''}`}
                onClick={() => toggleSelect(rowIndex, colIndex)}
                onMouseDown={(e) => handleMouseDown(rowIndex, colIndex, e)}
                onMouseEnter={() => handleMouseEnter(rowIndex, colIndex)}
                onTouchStart={(e) => handleTouchStart(rowIndex, colIndex, e)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
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
          <div className={`selected-word${invalid ? ' flash' : ''}`}>
            <p>
              <span className="word-keyword">Word</span>: {selectedWord || 'Tap tiles'}
            </p>
            <p>{selected.length} tile{selected.length === 1 ? '' : 's'}</p>
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
                      <div key={index} className={`leaderboard-item ${score === highScore ? 'current-high' : ''}`}>
                        <span className="rank">#{index + 1}</span>
                        <span className="score">{score.toLocaleString()}</span>
                        {score === highScore && <span className="high-score-badge">⭐</span>}
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
