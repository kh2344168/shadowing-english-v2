using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations
{
    /// <inheritdoc />
    public partial class EnforceCurriculumScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId",
                table: "GroupCurriculumAssignments");

            migrationBuilder.DropForeignKey(
                name: "FK_StudentStageProgress_PublishedLessonSlots_SlotId",
                table: "StudentStageProgress");

            migrationBuilder.DropIndex(
                name: "IX_StudentStageProgress_SlotId",
                table: "StudentStageProgress");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_PublishedLessonSlots_Id_PublishedCurriculumVersionId",
                table: "PublishedLessonSlots",
                columns: new[] { "Id", "PublishedCurriculumVersionId" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_PublishedCurriculumVersions_Id_GroupId",
                table: "PublishedCurriculumVersions",
                columns: new[] { "Id", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_StudentStageProgress_SlotId_PublishedCurriculumVersionId",
                table: "StudentStageProgress",
                columns: new[] { "SlotId", "PublishedCurriculumVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupCurriculumAssignments_PublishedCurriculumVersionId_GroupId",
                table: "GroupCurriculumAssignments",
                columns: new[] { "PublishedCurriculumVersionId", "GroupId" });

            migrationBuilder.AddForeignKey(
                name: "FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId_GroupId",
                table: "GroupCurriculumAssignments",
                columns: new[] { "PublishedCurriculumVersionId", "GroupId" },
                principalTable: "PublishedCurriculumVersions",
                principalColumns: new[] { "Id", "GroupId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StudentStageProgress_PublishedLessonSlots_SlotId_PublishedCurriculumVersionId",
                table: "StudentStageProgress",
                columns: new[] { "SlotId", "PublishedCurriculumVersionId" },
                principalTable: "PublishedLessonSlots",
                principalColumns: new[] { "Id", "PublishedCurriculumVersionId" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId_GroupId",
                table: "GroupCurriculumAssignments");

            migrationBuilder.DropForeignKey(
                name: "FK_StudentStageProgress_PublishedLessonSlots_SlotId_PublishedCurriculumVersionId",
                table: "StudentStageProgress");

            migrationBuilder.DropIndex(
                name: "IX_StudentStageProgress_SlotId_PublishedCurriculumVersionId",
                table: "StudentStageProgress");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_PublishedLessonSlots_Id_PublishedCurriculumVersionId",
                table: "PublishedLessonSlots");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_PublishedCurriculumVersions_Id_GroupId",
                table: "PublishedCurriculumVersions");

            migrationBuilder.DropIndex(
                name: "IX_GroupCurriculumAssignments_PublishedCurriculumVersionId_GroupId",
                table: "GroupCurriculumAssignments");

            migrationBuilder.CreateIndex(
                name: "IX_StudentStageProgress_SlotId",
                table: "StudentStageProgress",
                column: "SlotId");

            migrationBuilder.AddForeignKey(
                name: "FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId",
                table: "GroupCurriculumAssignments",
                column: "PublishedCurriculumVersionId",
                principalTable: "PublishedCurriculumVersions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StudentStageProgress_PublishedLessonSlots_SlotId",
                table: "StudentStageProgress",
                column: "SlotId",
                principalTable: "PublishedLessonSlots",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
