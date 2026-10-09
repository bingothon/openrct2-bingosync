export function generatePassphrase(length = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}


// Matches room ID from the response data
export function roomMatcher(data: string): string | null {
    const match = data.match(/window\.sessionStorage\.setItem\(["']room["'],\s*["']([a-zA-Z0-9-_]+)["']\);/s);
    return match ? match[1] : null;
}
