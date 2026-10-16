const sprite = new URL('../assets/icons.svg', import.meta.url).href;

export const icon = name => `<svg aria-hidden="true"><use href="${sprite}#${name}"></use></svg>`;
