# Changelog

## [3.0.0](https://github.com/ubiquity-os/plugin-sdk/compare/v2.0.6...v3.0.0) (2025-02-07)


### ⚠ BREAKING CHANGES

* postComment is now wrapped inside a class to avoid instance collisions

### Bug Fixes

* postComment is now wrapped inside a class to avoid instance collisions ([da526ff](https://github.com/ubiquity-os/plugin-sdk/commit/da526ffb2dbb4b008af87f60e7755c4f12922af2))
* the comments on pull-request reviews and pull requests / issues can be posted ([19950ff](https://github.com/ubiquity-os/plugin-sdk/commit/19950ff4475a1de210e36a4472e47de960e400fd))

## [2.0.6](https://github.com/ubiquity-os/plugin-sdk/compare/v2.0.5...v2.0.6) (2025-01-27)


### Bug Fixes

* changed logic for Actions to check the body ([96ab41c](https://github.com/ubiquity-os/plugin-sdk/commit/96ab41c2a8f4ee01b9a77587f4dfd27d43225008))

## [2.0.5](https://github.com/ubiquity-os/plugin-sdk/compare/v2.0.4...v2.0.5) (2025-01-27)


### Miscellaneous Chores

* release 2.0.5 ([394da0f](https://github.com/ubiquity-os/plugin-sdk/commit/394da0f1979c68b8cb93c747a920ce5a7e41e3d1))

## [2.0.4](https://github.com/ubiquity-os/plugin-sdk/compare/v2.0.3...v2.0.4) (2025-01-25)


### Bug Fixes

* bumped logger package version ([ba94c93](https://github.com/ubiquity-os/plugin-sdk/commit/ba94c93327470ce27ea0a2e84a7afde49dd28317))

## [2.0.3](https://github.com/ubiquity-os/plugin-sdk/compare/v2.0.2...v2.0.3) (2025-01-23)


### Bug Fixes

* the data is returned from the `postComment` function ([34d39a5](https://github.com/ubiquity-os/plugin-sdk/commit/34d39a5fa001f0192c3333102572a1f724666dd1))

## [2.0.2](https://github.com/ubiquity-os/plugin-sdk/compare/v2.0.1...v2.0.2) (2025-01-17)


### Bug Fixes

* change decode for server payload to match action payload ([a67be1c](https://github.com/ubiquity-os/plugin-sdk/commit/a67be1c29c082a9502c59640f0ea3c367f145458))

## [2.0.1](https://github.com/ubiquity-os/plugin-sdk/compare/v2.0.0...v2.0.1) (2025-01-07)


### Bug Fixes

* changed metadata header order ([0f8b8cf](https://github.com/ubiquity-os/plugin-sdk/commit/0f8b8cfded317ce1fff35c81d78cac3285b2d845))

## [2.0.0](https://github.com/ubiquity-os/plugin-sdk/compare/v1.1.1...v2.0.0) (2025-01-06)


### ⚠ BREAKING CHANGES

* comments can be reused on posting

### Features

* comments can be reused on posting ([81c706c](https://github.com/ubiquity-os/plugin-sdk/commit/81c706c2629ff25bd5eca415596de269da07637d))
* runtime info populated for worker and node environments ([c8f45f0](https://github.com/ubiquity-os/plugin-sdk/commit/c8f45f04715e7abaca6e1c47794c647cb9b526ac))

## [1.1.1](https://github.com/ubiquity-os/plugin-sdk/compare/v1.1.0...v1.1.1) (2024-12-03)


### Bug Fixes

* refactor getPluginOptions function and default kernel public key ([49d234e](https://github.com/ubiquity-os/plugin-sdk/commit/49d234e98aa72f2f79c92a56ffbf0c14861030ee))

## [1.1.0](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.11...v1.1.0) (2024-11-23)


### Features

* command interface ([eeae4e6](https://github.com/ubiquity-os/plugin-sdk/commit/eeae4e61c81c314f1b03dfc0821823e56b80bbb5))
* export octokit ([0a99120](https://github.com/ubiquity-os/plugin-sdk/commit/0a99120fa059e2f7530cb25a5ea56969a17f4212))
* manifest commands object ([96517a9](https://github.com/ubiquity-os/plugin-sdk/commit/96517a9a32719302cf998394941390c93d5f6aa9))
* typebox peer dependency ([eba4f6c](https://github.com/ubiquity-os/plugin-sdk/commit/eba4f6c279a1e515abdb81963e34bf7f68b72ae0))
* update handler return type ([becefc3](https://github.com/ubiquity-os/plugin-sdk/commit/becefc3666cde17ed45a92f3eba4bffdc0d698ed))


### Bug Fixes

* bun lockfile ([ac96198](https://github.com/ubiquity-os/plugin-sdk/commit/ac96198f839addf50d7b07c7f6623a021dec21fa))
* bypassSignatureVerification ([96449e0](https://github.com/ubiquity-os/plugin-sdk/commit/96449e0b06fd1e027d32d198a9599ab4ca0fbf3c))
* empty strings ([0150ded](https://github.com/ubiquity-os/plugin-sdk/commit/0150ded6a6089dd0e5b5732b88f510f87e640800))
* export octokit ([ae84bef](https://github.com/ubiquity-os/plugin-sdk/commit/ae84beffc9ef943a42bee1e41d933dada002d1bc))

## [1.0.11](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.10...v1.0.11) (2024-11-10)


### Bug Fixes

* remove type module for package ([004e173](https://github.com/ubiquity-os/plugin-sdk/commit/004e1735a6c98d7bb015ac649bb2bbb57890f48f))

## [1.0.10](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.9...v1.0.10) (2024-11-10)


### Bug Fixes

* add condition for GitHub App token retrieval ([5b0d845](https://github.com/ubiquity-os/plugin-sdk/commit/5b0d845e834bb41386c8aecb4fc9ddb2156accf4))
* add mock data and test cases for SDK and plugins ([e1bbf4e](https://github.com/ubiquity-os/plugin-sdk/commit/e1bbf4ec4a5c7d883ff546b53c42ab5f4bcc55cd))
* empty strings script ([d69bee2](https://github.com/ubiquity-os/plugin-sdk/commit/d69bee2825e47555724b63205f9c996abfa528e1))
* imported sign functions into the SDK ([151c588](https://github.com/ubiquity-os/plugin-sdk/commit/151c588527330300a404f177ff083da23659262c))
* inputs generation is now correct for both workers and actions ([1b81447](https://github.com/ubiquity-os/plugin-sdk/commit/1b814477f45dbc52357d47a03d0aae339d1a1a3e))
* optional signature disable ([26d8341](https://github.com/ubiquity-os/plugin-sdk/commit/26d834175ab9f1bda15a6c0c132f0b61e181fe3b))
* **tests:** use `jest.unstable_mockModule` for mocking imports ([0a617bd](https://github.com/ubiquity-os/plugin-sdk/commit/0a617bd77d0c02f49519ac8d9cd7f417ad294e9b))
* use nullish coalescing for pluginOptions defaults ([84bd57f](https://github.com/ubiquity-os/plugin-sdk/commit/84bd57f23c14eff70d4f732368077907949f0565))

## [1.0.9](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.8...v1.0.9) (2024-11-08)


### Bug Fixes

* split exports into individual modules ([516c6da](https://github.com/ubiquity-os/plugin-sdk/commit/516c6da87588b2e527b432e326860e2c4a7205a3))

## [1.0.8](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.7...v1.0.8) (2024-11-07)


### Bug Fixes

* added debug logs on wrong inputs ([902a566](https://github.com/ubiquity-os/plugin-sdk/commit/902a5662676f40ecf810cbe6b23288444af8f8b5))
* export octokit with core and not rest ([eb7c9ec](https://github.com/ubiquity-os/plugin-sdk/commit/eb7c9ec93395d3a664fa0fbc73742590224524e5))

## [1.0.7](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.6...v1.0.7) (2024-11-07)


### Bug Fixes

* update Octokit import to use rest module ([02e39b1](https://github.com/ubiquity-os/plugin-sdk/commit/02e39b1bad762cf251076118df145d8f3f2d655d))

## [1.0.6](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.5...v1.0.6) (2024-11-07)


### Bug Fixes

* add .npmrc file and update ignoreDependencies in knip config ([91d3880](https://github.com/ubiquity-os/plugin-sdk/commit/91d3880f454d12ae0c9462c1184b4ef5d9db762f))

## [1.0.5](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.4...v1.0.5) (2024-11-07)


### Bug Fixes

* fixed lock file ([59ca2d2](https://github.com/ubiquity-os/plugin-sdk/commit/59ca2d26eae008e1927e672d6dbfcb40e4c67253))

## [1.0.4](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.3...v1.0.4) (2024-11-07)


### Bug Fixes

* fixed husky ([b37fea8](https://github.com/ubiquity-os/plugin-sdk/commit/b37fea8297db1f776d0911fa2fea6591d7958a94))

## [1.0.3](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.2...v1.0.3) (2024-11-07)


### Bug Fixes

* fixed build ([bc176cc](https://github.com/ubiquity-os/plugin-sdk/commit/bc176cca7ee1b6ca98fe756305198d3d3658cc1b))

## [1.0.2](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.1...v1.0.2) (2024-11-07)


### Bug Fixes

* added config types ([abda2ba](https://github.com/ubiquity-os/plugin-sdk/commit/abda2ba9863d425d108854d67e3635b5556f362b))

## [1.0.1](https://github.com/ubiquity-os/plugin-sdk/compare/v1.0.0...v1.0.1) (2024-11-07)


### Bug Fixes

* **build:** rename build script to sdk:build ([fa15f9d](https://github.com/ubiquity-os/plugin-sdk/commit/fa15f9dfa046217f108d351d691a9095d51ef7c2))

## 1.0.0 (2024-11-07)


### Features

* remove Cypress tests, build scripts, and dependencies ([a0479e3](https://github.com/ubiquity-os/plugin-sdk/commit/a0479e373120b22d30b28510542904b7e4907807))
