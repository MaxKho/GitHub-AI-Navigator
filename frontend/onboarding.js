/// <reference types="chrome"/>

let currentSlide = 0;
const totalSlides = 6;

function updateSlide() {
  const slides = document.querySelectorAll('.slide');
  const dots = document.querySelectorAll('.progress-dot');

  slides.forEach((slide, index) => {
    slide.classList.remove('active', 'prev');
    if (index === currentSlide) {
      slide.classList.add('active');
    } else if (index < currentSlide) {
      slide.classList.add('prev');
    }
  });

  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index === currentSlide);
  });

  document.getElementById('prevBtn').disabled = currentSlide === 0;
  document.getElementById('nextBtn').disabled = currentSlide === totalSlides - 1;
}

function changeSlide(direction) {
  const newSlide = currentSlide + direction;
  if (newSlide >= 0 && newSlide < totalSlides) {
    currentSlide = newSlide;
    updateSlide();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prevBtn').addEventListener('click', () => changeSlide(-1));
  document.getElementById('nextBtn').addEventListener('click', () => changeSlide(1));

  const getStartedBtn = document.getElementById('getStartedBtn');
  if (getStartedBtn) {
    getStartedBtn.addEventListener('click', () => window.close());
    chrome.extension
  }

  updateSlide();

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') changeSlide(-1);
    if (e.key === 'ArrowRight') changeSlide(1);
  });
});
