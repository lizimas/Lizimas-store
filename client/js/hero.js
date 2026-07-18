let currentHeroSlide = 0;
let heroSlideCount = 0;
let heroIntervalId = null;

function goToHeroSlide(index) {
    const slides = document.querySelectorAll(".hero-slide");
    const dots = document.querySelectorAll(".hero-dot");

    if (slides.length === 0) return;

    slides.forEach(slide => slide.classList.remove("active"));
    dots.forEach(dot => dot.classList.remove("active"));

    slides[index].classList.add("active");
    if (dots[index]) dots[index].classList.add("active");

    currentHeroSlide = index;
}

function startHeroAutoRotate() {
    const slides = document.querySelectorAll(".hero-slide");
    heroSlideCount = slides.length;

    if (heroSlideCount === 0) return;

    if (heroIntervalId) clearInterval(heroIntervalId);

    heroIntervalId = setInterval(() => {
        const nextSlide = (currentHeroSlide + 1) % heroSlideCount;
        goToHeroSlide(nextSlide);
    }, 5000);
}

document.addEventListener("DOMContentLoaded", () => {
    startHeroAutoRotate();
});
