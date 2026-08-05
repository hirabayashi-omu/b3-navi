/**
 * B3 Building Room Search & Filter Engine
 */
import { FLOORS_DATA } from '../data/floors_data.js';

export class SearchEngine {
  constructor(inputElem, resultsElem, onSelectCallback) {
    this.input = inputElem;
    this.results = resultsElem;
    this.onSelect = onSelectCallback;

    this.bindEvents();
  }

  bindEvents() {
    this.input.addEventListener('input', () => {
      const query = this.input.value.trim().toLowerCase();
      this.search(query);
    });

    this.input.addEventListener('focus', () => {
      if (this.input.value.trim().length > 0) {
        this.results.style.display = 'flex';
      }
    });
  }

  search(query) {
    if (!query) {
      this.results.innerHTML = '';
      this.results.style.display = 'none';
      return;
    }

    const matches = [];

    FLOORS_DATA.forEach(floor => {
      floor.rooms.forEach(room => {
        const textToMatch = `${room.roomNo} ${room.name} ${room.type} ${floor.shortName}`.toLowerCase();
        if (textToMatch.includes(query)) {
          matches.push({
            floorNum: floor.floor,
            floorName: floor.shortName,
            room: room
          });
        }
      });
    });

    this.renderResults(matches);
  }

  renderResults(matches) {
    this.results.innerHTML = '';

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-item';
      empty.style.color = '#94a3b8';
      empty.textContent = '該当する部屋が見つかりません';
      this.results.appendChild(empty);
    } else {
      matches.forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerHTML = `
          <div>
            <strong>[${item.floorName}] ${item.room.roomNo}</strong> - ${item.room.name}
          </div>
          <span style="font-size:0.7rem; color:var(--accent-primary); opacity:0.8;">選択</span>
        `;

        div.addEventListener('click', () => {
          if (this.onSelect) {
            this.onSelect(item.floorNum, item.room.id);
          }
          this.results.style.display = 'none';
        });

        this.results.appendChild(div);
      });
    }

    this.results.style.display = 'flex';
  }
}
