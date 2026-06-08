export interface Vote {
	Uri: string;
	Name: string;
	Vote: number;
}

export interface Config {
	/** Full Kinopoisk votes page URL, e.g. https://www.kinopoisk.ru/user/1719755/votes.
	 *  The base origin (for building tweet links) is derived from this. */
	votesUrl: string;
	dataPath: string;
	/** PetBox Data connection for the votes cache (replaces the local votes.json file). */
	petbox: {
		endpoint: string;
		apiKey: string;
		project: string;
		db: string;
	};
	dumpPages: boolean;
	intervalMinutes: number;
	userAgent: string;
	twitter: {
		appKey: string;
		appSecret: string;
		accessToken: string;
		accessSecret: string;
	};
	proxyEnabled: boolean;
	proxy?: {
		server: string;
		username?: string;
		password?: string;
	};
	seq: {
		serverUrl: string;
		apiKey: string;
	};
}
