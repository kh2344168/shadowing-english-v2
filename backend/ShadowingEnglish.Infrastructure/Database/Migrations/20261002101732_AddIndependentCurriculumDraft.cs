using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations
{
    /// <inheritdoc />
    public partial class AddIndependentCurriculumDraft : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AssignedCurriculumTemplateId",
                table: "StudyGroups",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CurriculumAssignmentRevision",
                table: "StudyGroups",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<string>(
                name: "LastCurriculumAssignmentRequestHash",
                table: "StudyGroups",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LastCurriculumAssignmentRequestId",
                table: "StudyGroups",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PublishRequestHash",
                table: "PublishedCurriculumVersions",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceDraftRevision",
                table: "PublishedCurriculumVersions",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CreateRequestHash",
                table: "CurriculumTemplates",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "CurriculumTemplates",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "DraftRevision",
                table: "CurriculumTemplates",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DraftUpdatedAtUtc",
                table: "CurriculumTemplates",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastUpdateRequestHash",
                table: "CurriculumTemplates",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LastUpdateRequestId",
                table: "CurriculumTemplates",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CurriculumDraftLessonSlots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CurriculumTemplateId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    LessonVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    WeekNumber = table.Column<int>(type: "int", nullable: false),
                    DayNumber = table.Column<int>(type: "int", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CurriculumDraftLessonSlots", x => x.Id);
                    table.CheckConstraint("CK_CurriculumDraftLessonSlots_Position", "[WeekNumber] BETWEEN 1 AND 52 AND [DayNumber] BETWEEN 1 AND 7 AND [SortOrder] BETWEEN 1 AND 100");
                    table.ForeignKey(
                        name: "FK_CurriculumDraftLessonSlots_CurriculumTemplates_CurriculumTemplateId",
                        column: x => x.CurriculumTemplateId,
                        principalTable: "CurriculumTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CurriculumDraftLessonSlots_LessonVersions_LessonVersionId",
                        column: x => x.LessonVersionId,
                        principalTable: "LessonVersions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StudyGroups_AssignedCurriculumTemplateId",
                table: "StudyGroups",
                column: "AssignedCurriculumTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_CurriculumDraftLessonSlots_CurriculumTemplateId_LessonVersionId",
                table: "CurriculumDraftLessonSlots",
                columns: new[] { "CurriculumTemplateId", "LessonVersionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CurriculumDraftLessonSlots_CurriculumTemplateId_WeekNumber_DayNumber_SortOrder",
                table: "CurriculumDraftLessonSlots",
                columns: new[] { "CurriculumTemplateId", "WeekNumber", "DayNumber", "SortOrder" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CurriculumDraftLessonSlots_LessonVersionId",
                table: "CurriculumDraftLessonSlots",
                column: "LessonVersionId");

            migrationBuilder.AddForeignKey(
                name: "FK_StudyGroups_CurriculumTemplates_AssignedCurriculumTemplateId",
                table: "StudyGroups",
                column: "AssignedCurriculumTemplateId",
                principalTable: "CurriculumTemplates",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_StudyGroups_CurriculumTemplates_AssignedCurriculumTemplateId",
                table: "StudyGroups");

            migrationBuilder.DropTable(
                name: "CurriculumDraftLessonSlots");

            migrationBuilder.DropIndex(
                name: "IX_StudyGroups_AssignedCurriculumTemplateId",
                table: "StudyGroups");

            migrationBuilder.DropColumn(
                name: "AssignedCurriculumTemplateId",
                table: "StudyGroups");

            migrationBuilder.DropColumn(
                name: "CurriculumAssignmentRevision",
                table: "StudyGroups");

            migrationBuilder.DropColumn(
                name: "LastCurriculumAssignmentRequestHash",
                table: "StudyGroups");

            migrationBuilder.DropColumn(
                name: "LastCurriculumAssignmentRequestId",
                table: "StudyGroups");

            migrationBuilder.DropColumn(
                name: "PublishRequestHash",
                table: "PublishedCurriculumVersions");

            migrationBuilder.DropColumn(
                name: "SourceDraftRevision",
                table: "PublishedCurriculumVersions");

            migrationBuilder.DropColumn(
                name: "CreateRequestHash",
                table: "CurriculumTemplates");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "CurriculumTemplates");

            migrationBuilder.DropColumn(
                name: "DraftRevision",
                table: "CurriculumTemplates");

            migrationBuilder.DropColumn(
                name: "DraftUpdatedAtUtc",
                table: "CurriculumTemplates");

            migrationBuilder.DropColumn(
                name: "LastUpdateRequestHash",
                table: "CurriculumTemplates");

            migrationBuilder.DropColumn(
                name: "LastUpdateRequestId",
                table: "CurriculumTemplates");
        }
    }
}
