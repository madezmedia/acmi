#!/bin/bash

SINCE="midnight"

for dir in ~/dyad-apps/* ~/clawd ~/clawd/projects/*; do
  if [ -d "$dir/.git" ]; then
    COMMITS=$(cd "$dir" && git log --since="$SINCE" --format="%h - %s (%an)" --no-merges 2>/dev/null)
    if [ ! -z "$COMMITS" ]; then
      PROJECT_NAME=$(basename "$dir")
      echo "---"
      echo "Project: $PROJECT_NAME"
      echo "$COMMITS"
    fi
  fi
done
