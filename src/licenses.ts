/** What `corgi licenses` prints: Corgi's license, then the notices of the software it includes. */
import corgi from "../LICENSE" with { type: "text" };
import thirdParty from "../assets/licenses.txt" with { type: "text" };
import herdrSounds from "../assets/sounds/LICENSE" with { type: "text" };

export const text = `Corgi\n=====\n\n${corgi}\n\n${thirdParty}${herdrSounds}`;
