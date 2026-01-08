"use strict";
class DurationTimer {
    constructor(element) {
        this.seconds = 0;
        this.element = element;
    }
    start() {
        this.update();
        this.intervalId = window.setInterval(() => this.update(), 1000);
    }
    stop() {
        if (this.intervalId !== undefined) {
            clearInterval(this.intervalId);
        }
    }
    update() {
        this.seconds++;
        this.element.textContent = `Duration of stay:  ${[Math.floor(this.seconds / 3600), Math.floor(this.seconds % 3600 / 60), this.seconds % 60].map(unit => unit.toString().padStart(2, '0')).join(':')}`;
    }
}
