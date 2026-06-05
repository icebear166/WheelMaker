# Skills Repository Setup Design

Date: 2026-06-06
Status: Implemented

## Goal

Create a sibling `D:\Code\skills` workspace for personal skills, publish it to GitHub, and make the local WheelMaker Hub aware of it as a Project.

## Implementation

- `D:\Code\skills` is an independent Git repository.
- The GitHub remote is `git@github.com:swm8023/skills.git`.
- The repository is private by default to avoid exposing future personal skill instructions.
- The local WheelMaker config adds a Project entry with `name: "skills"` and `path: "D:\Code\skills"`.

## Skill Source Note

WheelMaker's Skills page accepts remote Skill Sources such as GitHub `owner/repo` values. Because this repository is private, `swm8023/skills` only works as a remote Skill Source when the `skills` CLI can access that private repository with available Git credentials. It can be made public later if direct unauthenticated Skill Source installation is required.
